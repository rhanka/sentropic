import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createProviderRegistry } from '@sentropic/mcp-platform/registry';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import { resource } from './stateful-host-auth.mjs';

const bytes = readFileSync(new URL('./fixtures/immo-tools.v1.json', import.meta.url));
if (createHash('sha256').update(bytes).digest('hex')
  !== '31487e8fb9b85019fc707ed3a7296e33156c46fb5fd3071d456d6dae1b44d998') throw new Error('Immo fixture hash mismatch');
export const fixture = JSON.parse(bytes);
export const limits = {
  maxSchemaBytes: 2 ** 21, maxSchemaDepth: 128, maxRequestBytes: 2 ** 25,
  maxArgumentBytes: 2 ** 24, maxArgumentDepth: 64, maxResultBytes: 2 ** 25, maxResultDepth: 64,
};
const requiredScope = name => name.startsWith('search_') ? 'immo:search'
  : ['list_documents', 'read_document_excerpt', 'get_grille_pdf', 'get_pv_pdf'].includes(name)
    ? 'immo:documents:read' : 'immo:read';

export function makeRegistry(tools = fixture.tools, claims = []) {
  const manifest = {
    appId: 'immo-app', providerId: 'immo', version: '0.0.1', displayName: 'Immo',
    resources: [], prompts: [], tools: tools.map(tool => ({
      kind: 'tool', name: tool.name, description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema, outputSchema: { type: 'object' },
      requiredScopes: [requiredScope(tool.name)], requiredClaims: claims,
      redactionClass: 'low', mutability: 'read-only', mutatesExternalSystem: false,
      idempotency: { required: false }, gates: {
        requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false,
      },
    })),
    authz: { requiredClaims: [], scopes: ['immo:read', 'immo:search', 'immo:documents:read'],
      tenantResolution: 'connector-instance' },
    audit: { eventKinds: ['invoke'] }, durability: {},
  };
  const registry = createProviderRegistry();
  const digest = computeManifestDigest(manifest);
  registry.register({
    manifest, adapter: { appId: 'immo-app' }, parameterSchema: { properties: {} },
    handlers: Object.fromEntries(tools.map(tool => [tool.name, {
      handlerId: tool.name, capabilityRef: tool.name,
      configSchema: { type: 'object', properties: {}, additionalProperties: false },
    }])),
    requiredPorts: [], provenance: {
      approvalRef: 'approved-706', revision: 'fixture-v1', manifestDigest: digest, reviewedBy: ['owner'],
    },
    toolValues: Object.fromEntries(tools.map(tool => [tool.name, { handlerId: tool.name, values: {} }])),
  });
  registry.select(['immo']); registry.configure('immo', {});
  const result = registry.compile({ bindings: {}, compatibility: { immo: { manifestDigest: digest } } });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.registry;
}

export function optionsFor(host, mode = 'http', overrides = {}) {
  return {
    host, registry: makeRegistry(), tools: fixture.tools, limits,
    authorize: async () => true,
    invoke: async name => structuredClone(fixture.captures[mode].calls[name].result),
    formatRefusal: (tool, reason, context) => ({
      content: [{ type: 'text', text: JSON.stringify({
        error: reason.kind === 'scope' ? `scope_denied:${reason.missingScopes[0]}` : reason.kind,
        tool, correlationId: context.correlationId,
      }, null, 2) }], isError: true,
    }),
    ...overrides,
  };
}

export async function openClient(host, tokenRef, router = host.app) {
  const client = new Client({ name: 'hosted-client', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      if (tokenRef.value) headers.set('authorization', `Bearer ${tokenRef.value}`);
      return router.fetch(new Request(url, { ...init, headers }));
    },
  });
  await client.connect(transport);
  return { client, transport, close: async () => { await transport.terminateSession(); await client.close(); } };
}

export function normalizeCorrelationId(value) {
  const copy = structuredClone(value);
  for (const block of copy.content ?? []) {
    if (block.type !== 'text') continue;
    const payload = JSON.parse(block.text);
    if (payload.correlationId === undefined) continue;
    const match = /"correlationId":\s*"([^"]+)"/.exec(block.text);
    if (!match || payload.correlationId !== match[1]) throw new Error('Invalid top-level correlation ID');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(match[1])) {
      throw new Error('Invalid correlation UUIDv4');
    }
    block.text = block.text.slice(0, match.index)
      + match[0].replace(match[1], '00000000-0000-4000-8000-000000000000')
      + block.text.slice(match.index + match[0].length);
  }
  return copy;
}
