import { readFileSync } from 'node:fs';
import { generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createClusterMeshModules } from '../../../../src/index.js';
import { createMcpRegistry } from '../../../../src/mcp/registry.js';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import type { RegistryDefinition } from '@sentropic/mcp-platform/registry';
import type { AppToolResult, BridgeTool } from '@sentropic/mcp-platform/transport/bridge';
import type { McpOAuthNamespaceOptions } from '../../../../src/compose/mcp-oauth.js';

// Captured schemas/descriptions: Radar #866 d85def82, immo-tools.v1.json (no live data).
export const tools = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8')) as BridgeTool[];
export const scopeFor = (name: string): string =>
  ['search_lots', 'search_signals'].includes(name) ? 'immo:search'
    : ['list_documents', 'read_document_excerpt', 'get_grille_pdf', 'get_pv_pdf'].includes(name)
      ? 'immo:documents:read' : 'immo:read';
export const resource = 'https://preprod.immo.example/mcp';
export const issuer = 'https://auth.example';
export const allScopes = ['immo:read', 'immo:search', 'immo:documents:read'];
export const stubs = ['search_lots', 'get_lot_card', 'get_opportunity_dossier', 'list_documents', 'read_document_excerpt'];

function fixtureResult(tool: string, args: unknown, sub: string, scopes: readonly string[], auditId: string): AppToolResult {
  return stubs.includes(tool)
    ? { ok: false, auditId, redactionClass: 'low', error: { code: 'not_wired_yet', message: 'not_wired_yet', retriable: false } }
    : { ok: true, auditId, redactionClass: 'low', output: { tool, args, sub, scopes } };
}

export async function fixture() {
  const keys = await generateKeyPair('RS256');
  const modules = createClusterMeshModules();
  const facade = createMcpRegistry({ modules });
  const manifest: RegistryDefinition['manifest'] = {
    appId: 'immo', providerId: 'immo', version: '0.0.1', displayName: 'Immo fixture',
    tools: tools.map((tool) => ({
      kind: 'tool', name: tool.name, description: tool.description ?? tool.name,
      requiredScopes: [scopeFor(tool.name)], requiredClaims: [],
      inputSchema: tool.schema as RegistryDefinition['manifest']['tools'][number]['inputSchema'],
      outputSchema: { type: 'object' }, redactionClass: 'low', mutability: 'read-only',
      mutatesExternalSystem: false, idempotency: { required: false },
      gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
    })),
    resources: [], prompts: [], authz: { requiredClaims: [], scopes: allScopes, tenantResolution: 'connector-instance' },
    audit: { eventKinds: ['invoke'] }, durability: {},
  };
  facade.register({
    manifest, adapter: {
      appId: 'immo', connectorId: 'fixture', manifest,
      resolveTenant: async (input) => ({ principalRef: input.principalSub, tenantRef: input.tenantRef,
        connectorInstanceId: input.connectorInstanceId }),
      listCapabilities: async () => manifest.tools,
      invokeTool: async (request) => fixtureResult(request.capabilityRef, request.input,
        request.ctx.principal.sub, request.ctx.principal.scopes, request.ctx.auditId),
      readResource: async () => ({ ok: false, auditId: 'fixture', redactionClass: 'low',
        error: { code: 'unsupported_operation', message: 'No fixture resources', retriable: false } }),
      validateSecrets: async () => [],
    },
    parameterSchema: { properties: {}, required: [] }, requiredPorts: [],
    handlers: Object.fromEntries(tools.map(({ name }) => [name, {
      handlerId: name, capabilityRef: name, configSchema: { type: 'object', properties: {}, additionalProperties: false },
    }])),
    toolValues: Object.fromEntries(tools.map(({ name }) => [name, { handlerId: name, values: {} }])),
    provenance: { approvalRef: 'fixture', revision: '1', manifestDigest: computeManifestDigest(manifest), reviewedBy: ['fixture'] },
  });
  facade.select(['immo']);
  const compiled = await facade.compile({ bindings: {}, compatibility: { immo: { manifestDigest: computeManifestDigest(manifest) } } });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const options: McpOAuthNamespaceOptions = {
    registry: compiled.registry, tools, resource, authorizationServers: [issuer],
    keySource: { resolveKey: async () => keys.publicKey }, scopesSupported: allScopes,
    requiredIngressScopes: ['immo:read'], environment: 'preprod', subjectClientId: 'immo-mcp',
    sessions: { createTransport: () => new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true,
    }) },
    resolveAccount: async () => ({ allowed: true }),
    invoke: async (tool, args, call) => fixtureResult(tool, args, call.principal.sub, call.principal.scopes, call.correlationId),
  };
  const token = (claims: JWTPayload = {}) => new SignJWT({
    sub: 'alice', iss: issuer, aud: resource, iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600, client_id: 'immo-mcp', scope: allScopes.join(' '), ...claims,
  }).setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
  return { modules, options, token, keys };
}

export const rpc = (method: string, params: Record<string, unknown> = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });
export const initialize = () => rpc('initialize', {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'existing-client', version: '1' },
});
export function post(body: unknown, token?: string, session?: string): RequestInit {
  return { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
  }, body: JSON.stringify(body) };
}
