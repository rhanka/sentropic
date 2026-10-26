import { describe, expect, it } from 'vitest';
import { createGuardedRunner, createRegistryPolicy, createMcpNamespaceModule } from '../src/compose/mcp.js';
import { hostContext } from '../../mcp-platform/tests/memory/host-fixture.js';
import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createProviderRegistry } from '@sentropic/mcp-platform/registry';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import { MEMORY_TOOLS } from '@sentropic/mcp-platform/memory';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('P01.mesh.memory-context', () => {
  it('should preserve the full per-call context and cancellation through guards', async () => {
    const context = hostContext(), signal = new AbortController().signal;
    const call = { context, signal };
    let seen: unknown;
    const guarded = createGuardedRunner({
      contextResolver: async () => ({ sub: 'user-1', tid: 'tenant-1', clientId: 'client-1', scopes: ['mcp:tools:invoke'] }),
      invocation: { authorize: async () => ({ allowed: true }) },
      runner: { run: async (_tool, _args, _identity, forwarded) => {
        seen = forwarded;
        return { ok: true, output: {}, auditId: 'audit-host-1', redactionClass: 'high' };
      } },
    });
    await guarded.run('engram_memory_search', { purpose_ref: 'purpose-1' }, undefined, call);
    expect(seen).toBe(call);
  });
  it('should isolate concurrent subjects and tenants while keeping workspace distinct', async () => {
    const first = hostContext(), second = hostContext();
    first.workspaceRef = 'workspace-a'; first.memory!.binding = { ...first.memory!.binding, workspace_id: 'workspace-a' };
    second.principal.sub = 'user-2'; second.principal.tenantRef = second.tenantRef = 'tenant-2';
    second.principal.claims = { sub: 'user-2', tid: 'tenant-2' }; second.workspaceRef = 'workspace-b';
    second.memory!.binding = { ...second.memory!.binding, sub: 'user-2', principal_id: 'user-2',
      tid: 'tenant-2', tenant_id: 'tenant-2', workspace_id: 'workspace-b' };
    const seen: unknown[] = [];
    const guarded = createGuardedRunner({ contextResolver: async () => { throw Error('lossy resolver'); },
      invocation: { authorize: async () => ({ allowed: true }) }, runner: { run: async (_t, _a, identity, call) => {
        await Promise.resolve(); seen.push([identity?.tenantRef, call!.context.workspaceRef, call!.context.principal.sub]);
        return { ok: true, output: {}, auditId: call!.context.auditId, redactionClass: 'high' };
      } } });
    await Promise.all([first, second].map(context => guarded.run('engram_memory_search',
      { purpose_ref: 'purpose-1' }, undefined, { context, signal: new AbortController().signal })));
    expect(seen).toEqual([['tenant-1', 'workspace-a', 'user-1'], ['tenant-2', 'workspace-b', 'user-2']]);
  });
  it('should refuse missing, substituted or aborted context before any effect', async () => {
    let effects = 0;
    const guarded = createGuardedRunner({ contextResolver: async () => ({} as never),
      invocation: { authorize: async () => { effects++; return { allowed: true }; } },
      runner: { run: async () => { effects++; return {} as never; } } });
    await expect(guarded.run('engram_memory_search', {}, undefined)).rejects.toThrow();
    for (const change of [(c: ReturnType<typeof hostContext>) => { c.auditId = 'substituted'; },
      (c: ReturnType<typeof hostContext>) => { c.memory!.binding.selected_source_id = 'foreign' as never; },
      (c: ReturnType<typeof hostContext>) => { c.memory!.expectedActiveGeneration = '2'; }]) {
      const context = hostContext(); change(context);
      await expect(guarded.run('engram_memory_search', {}, undefined,
        { context, signal: new AbortController().signal })).rejects.toThrow();
    }
    await expect(guarded.run('engram_memory_search', {}, undefined,
      { context: hostContext(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(effects).toBe(0);
  });
  it('should carry verified sub/tid claims into the single compiled plan and refuse foreign providers', async () => {
    const resolution = { providerId: 'sentropic.engram.memory', capabilityName: 'engram_memory_search',
      requiredScopes: ['mcp:tools:invoke'], requiredClaims: ['sub', 'tid'] };
    const policy = createRegistryPolicy({ resolveTool: () => resolution } as never);
    const context = hostContext(), principal = { sub: 'user-1', tid: 'tenant-1', clientId: 'client-1', scopes: [] };
    await expect(policy.authorize({ tool: 'engram_memory_search', principal, context })).resolves.toEqual({ allowed: true });
    resolution.providerId = 'foreign';
    await expect(policy.authorize({ tool: 'engram_memory_search', principal, context })).resolves.toMatchObject({
      allowed: false, reason: 'source_binding_mismatch' });
  });
  it('should carry authoritative context through HTTP discovery and a real compiled registry', async () => {
    const context = hostContext();
    context.workspaceRef = 'workspace-separate';
    context.memory!.binding = { ...context.memory!.binding, workspace_id: 'workspace-separate' };
    const capability = MEMORY_TOOLS.find(t => t.name === 'engram_memory_get')!;
    const manifest = { appId: 'engram', providerId: 'sentropic.engram.memory', version: '1.0.0', displayName: 'Memory',
      resources: [], prompts: [], tools: [capability], authz: { requiredClaims: ['sub', 'tid'],
        scopes: ['mcp:tools:invoke'], tenantResolution: 'connector-instance' }, audit: { eventKinds: ['invoke'] }, durability: {} };
    const registry = createProviderRegistry();
    registry.register({ manifest, adapter: { appId: 'engram', connectorId: 'engram-memory' },
      parameterSchema: { properties: {}, required: [] }, requiredPorts: [],
      handlers: { get: { handlerId: 'get', capabilityRef: capability.name,
        configSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] } } },
      toolValues: { [capability.name]: { handlerId: 'get', values: {} } },
      provenance: { approvalRef: 'approval', revision: '1', manifestDigest: computeManifestDigest(manifest as never), reviewedBy: ['owner'] },
    } as never);
    registry.select(['sentropic.engram.memory']);
    const compiled = registry.compile({ bindings: {}, compatibility: {
      'sentropic.engram.memory': { manifestDigest: computeManifestDigest(manifest as never) } } });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw Error('Memory fixture failed compilation');
    const modules = { load: async (id: string) => {
      if (id === 'mcp-platform/bridge') return import('@sentropic/mcp-platform/transport/bridge');
      if (id === 'mcp-platform/hono') return import('@sentropic/mcp-platform/hono');
      throw Error('unexpected module');
    } };
    const envelope = { ok: false, auditId: context.auditId, redactionClass: 'high',
      error: { code: 'NOT_FOUND', message: 'Not found', retriable: false } } as const;
    let calls = 0;
    const module = await createMcpNamespaceModule(modules as never, {
      registry: compiled.registry, generationId: '1', tools: [{ name: capability.name, schema: capability.inputSchema,
        outputSchema: capability.outputSchema as never, profile: 'sentropic.engram.memory-wire/v1',
        schemaProfile: 'sentropic.engram.memory-tools/2020-12-v1', _meta: { source: 'mcp:engram-memory' } }],
      auth: { routes: new Hono(), scopes: { discover: 'mcp:discover', invoke: 'mcp:tools:invoke', read: 'mcp:resources:read' },
        context: () => null, require: () => async (_c: unknown, next: () => Promise<void>) => next() } as never,
      contextResolver: async () => ({ sub: 'user-1', clientId: 'client-1', tid: 'workspace-separate', scopes: ['mcp:tools:invoke'] }),
      memoryContext: async () => context, invocation: { authorize: async () => ({ allowed: true }) },
      createTransport: () => new WebStandardStreamableHTTPServerTransport(),
      runner: { run: async (_tool, _args, identity, call) => {
        calls++; expect(identity?.tenantRef).toBe('tenant-1'); expect(call?.context).toBe(context); return envelope;
      } },
    });
    const router = module.createRouter({ receipts: {} as never, context: { verify: async () => ({
      invocationId: 'req-1', correlationId: 'corr-1', generationId: '1', principal: { principalId: 'user-1', kind: 'human', verifierId: 'v' },
      workspace: { workspaceId: 'workspace-separate', bindingId: 'w', revision: '1' }, scopes: ['mcp:tools:invoke'],
      policyRevision: '2', issuedAt: context.memory!.now,
    }) } } as never);
    const client = new Client({ name: 'memory-context', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL('http://memory.test/mcp'), {
        requestInit: { headers: { 'x-mcp-tenant-ref': 'forged-tenant' } },
        fetch: async (_url, init) => router.request('/mcp', init),
      }));
      expect((await client.listTools()).tools[0]).toMatchObject({ outputSchema: capability.outputSchema, _meta: { source: 'mcp:engram-memory' } });
      expect(await client.callTool({ name: capability.name, arguments: { record_id: 'mem_abc', purpose_ref: 'purpose-1' } }))
        .toEqual({ isError: true, structuredContent: envelope, content: [{ type: 'text', text: JSON.stringify(envelope) }] });
      expect(calls).toBe(1);
    } finally { await client.close(); }
  });
});
