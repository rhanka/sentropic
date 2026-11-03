/**
 * SNAPSHOT — byte-stable tools/list catalogue for an mcp-platform composition.
 *
 * Why this file exists: MCP hosts such as claude.ai key per-tool "Always
 * allow" permissions on the exact tool definition bytes (name, description,
 * inputSchema, outputSchema, annotations, _meta). If any of those bytes move
 * between deployments, package versions, configurations or profile switches,
 * the owner must re-approve every tool in every session. The rule for every
 * mcp-platform-composed tool is therefore: descriptors are frozen constants
 * (see MEMORY_TOOLS and provider manifests); anything dynamic — provider
 * version, manifest digest, configuration values, profile ids — belongs to
 * server metadata or results, never to a tool definition.
 *
 * This test composes a real registry (createProviderRegistry: register,
 * select, configure, compile) with two providers, serves the compiled tools
 * over the real MCP SDK bridge (registerMcpWireTools over an in-memory link,
 * the same path the stdio/HTTP transports use) and compares the full
 * tools/list catalogue against the checked-in snapshot
 * tests/snapshots/tools-list-catalogue.json. It fails on ANY definition
 * change. To deliberately update the snapshot: delete the JSON file and
 * re-run this test once — it rewrites the file and fails, then passes on the
 * next run; commit the result in the same change as the definition.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { registerMcpWireTools } from '../src/transport/bridge.js';
import { compileMcpToolSchemas, type McpToolValidationLimits } from '../src/transport/tool-schemas.js';
import { createProviderRegistry, type LocalProviderDefinition } from '../src/registry.js';
import { computeManifestDigest, type ToolConfigurationProvenance } from '../src/tool-configuration.js';
import { MEMORY_TOOLS } from '../src/memory/contracts.js';
import type { AppConnectorProviderAdapter, AppMcpProviderManifest, CapabilityTool } from '../src/manifest.js';
import type { AppToolResult } from '../src/runtime.js';

const SNAPSHOT_URL = new URL('./snapshots/tools-list-catalogue.json', import.meta.url);
const LIMITS: McpToolValidationLimits = {
  maxSchemaBytes: 2 ** 21, maxSchemaDepth: 128, maxRequestBytes: 2 ** 25,
  maxArgumentBytes: 2 ** 24, maxArgumentDepth: 64, maxResultBytes: 2 ** 25, maxResultDepth: 64,
};

/** Deterministic JSON: sorted keys, undefined dropped, stable formatting. */
function canonical(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, sortKeys(entry)] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  }
  return value;
}

/** The wire projection of one tools/list entry, exactly as hosts receive it. */
function projectTool(tool: Tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    _meta: tool._meta,
  };
}

function makeManifest(providerId: string, tools: CapabilityTool[]): AppMcpProviderManifest {
  return {
    appId: 'snapshot-app',
    providerId,
    version: '0.0.0',
    displayName: `Snapshot ${providerId}`,
    resources: [],
    tools,
    prompts: [],
    authz: { requiredClaims: [], scopes: ['snapshot:use'], tenantResolution: 'connector-instance' },
    audit: { eventKinds: ['invoke'] },
    durability: {},
  };
}

const stubAdapter = (manifest: AppMcpProviderManifest): AppConnectorProviderAdapter => ({
  appId: manifest.appId,
  connectorId: manifest.providerId,
  manifest,
  resolveTenant: async (input) => ({
    principalRef: input.principalSub,
    tenantRef: input.tenantRef,
    connectorInstanceId: input.connectorInstanceId,
  }),
  listCapabilities: async () => [...manifest.tools],
  invokeTool: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' }),
  readResource: async () => ({ ok: true, auditId: 'audit-1', redactionClass: 'low' }),
  validateSecrets: async () => [],
});

function makeDefinition(providerId: string, tools: CapabilityTool[], values: Record<string, unknown> = {}): LocalProviderDefinition {
  const manifest = makeManifest(providerId, tools);
  const handlers: LocalProviderDefinition['handlers'] = {};
  const toolValues: LocalProviderDefinition['toolValues'] = {};
  for (const tool of tools) {
    handlers[`${tool.name}-handler`] = {
      handlerId: `${tool.name}-handler`,
      capabilityRef: tool.name,
      configSchema: { type: 'object',
        properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 } },
        additionalProperties: false },
    };
    toolValues[tool.name] = { handlerId: `${tool.name}-handler`, values };
  }
  const provenance: ToolConfigurationProvenance = {
    approvalRef: 'snapshot-local-1',
    revision: 'rev-1',
    manifestDigest: computeManifestDigest(manifest),
    reviewedBy: ['snapshot-owner'],
  };
  return {
    manifest,
    adapter: stubAdapter(manifest),
    parameterSchema: {
      properties: { maxResults: { type: 'integer', minimum: 1, maximum: 100 } },
      required: [],
    },
    handlers,
    requiredPorts: ['storage'],
    provenance,
    toolValues,
  };
}

const probeRead: CapabilityTool = {
  kind: 'tool',
  name: 'probe_read',
  description: 'Synthetic read tool for the snapshot composition.',
  requiredScopes: ['snapshot:use'],
  requiredClaims: [],
  inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'], additionalProperties: false },
  outputSchema: { type: 'object', additionalProperties: true },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};
const probeWrite: CapabilityTool = {
  kind: 'tool',
  name: 'probe_write',
  description: 'Synthetic write tool for the snapshot composition.',
  requiredScopes: ['snapshot:use'],
  requiredClaims: [],
  inputSchema: { type: 'object', properties: {
    idempotencyKey: { type: 'string', minLength: 1 }, note: { type: 'string' } },
    required: ['idempotencyKey'], additionalProperties: false },
  outputSchema: { type: 'object', additionalProperties: true },
  redactionClass: 'low',
  mutability: 'state-transition',
  mutatesExternalSystem: true,
  idempotency: { required: true, scope: 'principal' },
  gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false },
};

/** Compose the registry and return the wire descriptors of the selected tools. */
function compose(probeValues: Record<string, unknown> = {}): { wireTools: Tool[]; resolve: (name: string) => { inputSchema: unknown } | undefined } {
  const memory = makeDefinition('engram.memory', [...MEMORY_TOOLS]);
  const probe = makeDefinition('snapshot.probe', [probeRead, probeWrite], probeValues);
  const registry = createProviderRegistry();
  registry.register(memory);
  registry.register(probe);
  registry.select(['engram.memory', 'snapshot.probe']);
  registry.configure('engram.memory', {});
  registry.configure('snapshot.probe', probeValues);
  const compiled = registry.compile({
    bindings: { storage: { kind: 'memory' } },
    compatibility: {
      'engram.memory': { manifestDigest: computeManifestDigest(memory.manifest) },
      'snapshot.probe': { manifestDigest: computeManifestDigest(probe.manifest) },
    },
  });
  if (!compiled.ok) throw new Error(`snapshot composition failed: ${JSON.stringify(compiled.diagnostics)}`);
  const wireTools: Tool[] = [memory, probe].flatMap((definition) => definition.manifest.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // SDK discovery requires object roots; preserve every producer constraint.
    inputSchema: { type: 'object', ...(tool.inputSchema as Record<string, unknown>) },
    outputSchema: { type: 'object', ...(tool.outputSchema as Record<string, unknown>) },
  })));
  return { wireTools, resolve: (name) => compiled.registry.resolveTool(name) };
}

async function listToolsOverSdk(tools: Tool[]): Promise<Tool[]> {
  const schemas = compileMcpToolSchemas(tools, LIMITS);
  const server = new Server({ name: 'snapshot-host', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerMcpWireTools(server, tools, {
    run: async (): Promise<AppToolResult> => ({ ok: true, output: {}, auditId: 'audit-snapshot', redactionClass: 'low' }),
  }, {
    schemas,
    limits: LIMITS,
    formatFailure: () => ({ content: [{ type: 'text', text: 'rejected' }], isError: true }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'snapshot-client', version: '0.0.0' });
  await client.connect(clientTransport);
  const listed = (await client.listTools()).tools;
  await client.close();
  await server.close();
  return listed;
}

describe('tools/list snapshot (byte-stable tool definitions)', () => {
  it('serves the composed catalogue and matches the checked-in snapshot', async () => {
    const { wireTools, resolve } = compose();
    // The wire descriptor must be the digest-bound manifest definition (stateful preflight rule).
    for (const tool of wireTools) {
      expect(tool.inputSchema).toEqual(resolve(tool.name)?.inputSchema);
    }
    const listed = (await listToolsOverSdk(wireTools)).map(projectTool);
    if (!existsSync(SNAPSHOT_URL)) {
      mkdirSync(dirname(fileURLToPath(SNAPSHOT_URL)), { recursive: true });
      writeFileSync(SNAPSHOT_URL, canonical({ toolsList: listed }));
      throw new Error('tools/list snapshot written; re-run this test, then commit the snapshot with the change');
    }
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8')) as { toolsList: unknown[] };
    expect(listed).toEqual(snapshot.toolsList);
    // Definitions carry no per-deployment values.
    const allDefinitions = canonical(listed);
    expect(allDefinitions).not.toContain('0.0.0');
    expect(allDefinitions).not.toContain(computeManifestDigest(makeManifest('x', [])));
  });

  it('keeps the catalogue byte-identical across recompiles with different configuration', async () => {
    const first = (await listToolsOverSdk(compose({ maxResults: 5 }).wireTools)).map(projectTool);
    const second = (await listToolsOverSdk(compose({ maxResults: 50 }).wireTools)).map(projectTool);
    expect(canonical(first)).toBe(canonical(second));
  });
});
