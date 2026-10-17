/**
 * Lot 7 — stdio leaf surface: the same compiled plan over real stdio framing,
 * driven through in-memory streams (no process I/O in tests). The full
 * handshake, list and call run over newline-delimited JSON-RPC; stdio
 * identity comes from the environment and chains through the guard.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import type { ClusterMeshModules } from '../../src/modules/contracts.js';
import { createMcpStdioLeaf } from '../../src/mcp/stdio.js';
import { createMcpRegistry } from '../../src/mcp/registry.js';

const kernelModules = (): ClusterMeshModules =>
  ({
    load: async (id: string) => {
      if (id === 'mcp-platform/registry') return import('@sentropic/mcp-platform/registry');
      if (id === 'mcp-platform/bridge') return import('@sentropic/mcp-platform/transport/bridge');
      if (id === 'mcp-platform/stdio') return import('@sentropic/mcp-platform/transport/stdio');
      throw new Error(`unexpected module load in surface spec: ${id}`);
    },
  }) as unknown as ClusterMeshModules;

const MANIFEST = {
  appId: 'probe-app',
  providerId: 'immo',
  version: '0.0.0',
  displayName: 'Probe immo',
  resources: [],
  tools: [
    {
      kind: 'tool',
      name: 'immo_search',
      description: 'Synthetic.',
      requiredScopes: ['probe:use'],
      requiredClaims: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      redactionClass: 'low',
      mutability: 'read-only',
      mutatesExternalSystem: false,
      idempotency: { required: false },
      gates: {
        requiresElicitation: false,
        requiresHumanConfirmation: false,
        requiresPrincipalGate: false,
      },
    },
  ],
  prompts: [],
  authz: { requiredClaims: [], scopes: ['probe:use'], tenantResolution: 'connector-instance' },
  audit: { eventKinds: ['invoke'] },
  durability: {},
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
};

const LIMIT_SCHEMA = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['limit'],
  additionalProperties: false,
};

async function compiledRegistry() {
  const facade = createMcpRegistry({ modules: kernelModules() });
  facade.register({
    manifest: MANIFEST,
    adapter: { appId: 'probe-app', connectorId: 'probe' },
    parameterSchema: { properties: {}, required: [] },
    handlers: {
      'immo_search-handler': {
        handlerId: 'immo_search-handler',
        capabilityRef: 'immo_search',
        configSchema: LIMIT_SCHEMA,
      },
    },
    requiredPorts: [],
    provenance: { approvalRef: 'a', revision: 'r', manifestDigest: 'm', reviewedBy: ['probe-owner'] },
    toolValues: { immo_search: { handlerId: 'immo_search-handler', values: { limit: 20 } } },
  } as never);
  facade.select(['immo']);
  const compiled = await facade.compile({
    bindings: {},
    compatibility: { immo: { manifestDigest: computeManifestDigest(MANIFEST) } },
  });
  if (!compiled.ok) throw new Error('fixture must compile');
  return compiled.registry;
}

interface Session {
  stdin: PassThrough;
  stdout: PassThrough;
  pending: Map<string | number, (value: unknown) => void>;
  buffer: string;
}

async function openSession(
  options: Parameters<typeof createMcpStdioLeaf>[1] & { stdin: PassThrough; stdout: PassThrough },
): Promise<Session> {
  const leaf = await createMcpStdioLeaf(kernelModules(), options);
  await leaf.start();
  const session: Session = { stdin: options.stdin, stdout: options.stdout, pending: new Map(), buffer: '' };
  options.stdout.on('data', (chunk: Buffer) => {
    session.buffer += chunk.toString('utf8');
    const lines = session.buffer.split('\n');
    session.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const message = JSON.parse(line) as { id?: string | number };
      if (message.id !== undefined) session.pending.get(message.id)?.(message);
    }
  });
  return session;
}

function send(session: Session, message: unknown): Promise<unknown> {
  const id = (message as { id: string | number }).id;
  return new Promise((resolve) => {
    session.pending.set(id, resolve);
    session.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

describe('stdio leaf surface', () => {
  it('serves handshake, list and call over stdio framing', async () => {
    const seen: unknown[] = [];
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const session = await openSession({
      registry: await compiledRegistry(),
      tools: [{ name: 'immo_search', description: 'Synthetic', schema: SCHEMA }],
      runner: {
        run: async (_tool, args, identity) => {
          seen.push(identity);
          return { ok: true, output: { echo: args }, auditId: 'a', redactionClass: 'low' };
        },
      },
      contextResolver: async (identity) => ({
        sub: identity?.clientId ?? 'anonymous',
        clientId: identity?.clientId ?? 'anonymous',
        tid: identity?.tenantRef ?? null,
        scopes: [...(identity?.scopes ?? [])],
      }),
      invocation: { authorize: async () => ({ allowed: true as const }) },
      env: { MCP_CLIENT_ID: 'cli', MCP_TENANT_REF: 't-5', MCP_SCOPES: 'probe:use' },
      stdin,
      stdout,
    });
    const hello = (await send(session, {
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
    })) as { result: { serverInfo: { name: string } } };
    expect(hello.result.serverInfo.name).toBe('@sentropic/cluster-mesh/mcp');
    session.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = (await send(session, {
      jsonrpc: '2.0',
      id: 'list-1',
      method: 'tools/list',
      params: {},
    })) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(['immo_search']);
    const called = (await send(session, {
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'immo_search', arguments: { surface: 80 } },
    })) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(called.result.isError).toBe(false);
    expect(called.result.content[0]?.text).toBe('{"echo":{"surface":80}}');
    expect(seen).toEqual([
      { clientId: 'cli', tenantRef: 't-5', scopes: ['probe:use'], hasBearer: false },
    ]);
  });

  it('refuses startup for bridge tools outside the compiled plan', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    await expect(
      createMcpStdioLeaf(kernelModules(), {
        registry: await compiledRegistry(),
        tools: [{ name: 'nope.tool', schema: SCHEMA }],
        runner: { run: async () => ({ ok: true, output: {}, auditId: 'a', redactionClass: 'low' }) },
        contextResolver: async () => ({ sub: 'x', clientId: 'x', tid: null, scopes: [] }),
        invocation: { authorize: async () => ({ allowed: true as const }) },
        env: {},
        stdin,
        stdout,
      }),
    ).rejects.toThrow(/not in the compiled plan/);
  });
});
