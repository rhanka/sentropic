import { describe, expect, it } from 'vitest';
import { createGuardedRunner, createRegistryPolicy } from '../src/compose/mcp.js';
import { hostContext } from '../../mcp-platform/tests/memory/host-fixture.js';

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
});
