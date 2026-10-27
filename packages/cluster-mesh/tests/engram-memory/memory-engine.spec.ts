import { describe, expect, it, vi } from 'vitest';
import type { MemoryCampaignHost } from './memory-pg-host.js';
import { memoryEngine } from './memory-engine.js';

const recovery = vi.hoisted(() => ({ prove: vi.fn(), verify: vi.fn() }));
vi.mock('../../src/engram-memory/binding.js', async (load) => ({
  ...await load<object>(), proveForRecoveryAuthorized: recovery.prove, verifyHostBinding: recovery.verify,
}));
vi.mock('@sentropic/engram/memory-substrate', () => ({
  createMemoryPortV2: (dependencies: { canonical_store: unknown }) => dependencies.canonical_store,
}));

describe('memory engine authorized recovery', () => {
  const setup = () => {
    recovery.prove.mockReset(); recovery.verify.mockReset();
    const refused = { ok: false, error: { code: 'UNAUTHORIZED', operation: 'request_admission', retryable: false } };
    const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
    const store = { readPending: vi.fn(async () => refused), commitPending: vi.fn(),
      applyLifecycle: vi.fn(), applyAdmission: vi.fn() };
    const host = { store, scopeBinding: { store_id: 'store-1', scope, resolveScope: () => scope },
      binding: { memoryGrant: { principalId: 'host-1' } }, kernel: { bind: vi.fn() },
      handle: { checkFence: vi.fn() }, fence: {}, ledger: { read: vi.fn(async () => ({
        candidateId: 'candidate-1', storeId: 'store-1', scope, invocationId: 'inv-host-1',
        hostPrincipal: 'host-1', continuationIds: [], envelopeDigest: 'a'.repeat(64),
        state: 'terminal', receipt: null, cursor: null,
      })) } } as unknown as MemoryCampaignHost;
    memoryEngine(host);
    return { host, refused, read: () => store.readPending({ candidate_id: 'candidate-1' } as never) };
  };

  it('should recover a retained terminal candidate after asynchronous host authorization', async () => {
    const { host, read } = setup();
    let release!: (proof: { state: string }) => void;
    recovery.prove.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    let settled = false;
    const result = read().then((value) => { settled = true; return value; });
    await vi.waitFor(() => expect(recovery.prove).toHaveBeenCalledOnce());
    expect(recovery.prove).toHaveBeenCalledWith(expect.anything(), host.binding, 'candidate-1', host.scopeBinding.scope, host.kernel);
    expect(settled).toBe(false);
    release({ state: 'terminal' });
    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('should preserve refusal when the authorized proof is not terminal', async () => {
    const { read, refused } = setup();
    recovery.prove.mockResolvedValue({ state: 'reserved' });
    await expect(read()).resolves.toBe(refused);
  });

  it('should refuse recovery when asynchronous host authorization fails', async () => {
    const { read } = setup();
    recovery.prove.mockRejectedValue(new Error('maintain grant revoked'));
    await expect(read()).rejects.toThrow('maintain grant revoked');
  });
});
