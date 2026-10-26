import type { CanonicalMemoryStorePort, CryptoPort } from '@sentropic/engram/memory-substrate';
import { describe, expect, it, vi } from 'vitest';
import { bindHostCandidateScope, type HostInvocation } from './host-scope-binding.js';
import { g1ScopeBinding, G1_STORE_ID } from './g1-host.js';

const digest = `sha256:${'a'.repeat(64)}` as const;
const sealed = {
  candidate_id: 'candidate-1', envelope_ref: 'envelope-1', envelope_digest: digest,
  key_ref: 'key-1', ciphertext: 'opaque sealed bytes',
};
const pending = {
  control: { candidate_id: 'candidate-1', envelope_digest: digest, state: 'pending' as const,
    created_cursor: '0', policy_id: 'policy-1', policy_version: '1' },
  sealed,
  capture_event: { candidate_id: 'candidate-1' },
} as Parameters<CanonicalMemoryStorePort['commitPending']>[0];
const lifecycle = {
  command: { candidate_id: 'candidate-1', operation: 'reject' },
  event: { candidate_id: 'candidate-1' }, projection_batch: {},
} as Parameters<CanonicalMemoryStorePort['applyLifecycle']>[0];

const host = () => {
  const original: HostInvocation = Object.freeze({ invocationId: 'invocation-1', storeId: G1_STORE_ID, scopeRef: G1_STORE_ID });
  let current: HostInvocation | null = original;
  const commit = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const transition = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const seal = vi.fn().mockResolvedValue({ ok: true, value: sealed });
  const store = { commitPending: commit, applyLifecycle: transition } as unknown as CanonicalMemoryStorePort;
  const crypto = { version: 1, seal } as unknown as CryptoPort;
  const bound = bindHostCandidateScope({ store, crypto, binding: g1ScopeBinding(), currentInvocation: () => current });
  return { ...bound, original, commit, transition, seal, rawStore: store,
    enter: (invocation: HostInvocation | null) => { current = invocation; },
    // Host-private engine dependency: callers receive only the guarded store.
    capture: () => bound.crypto.seal({ candidate_id: 'candidate-1', plaintext: 'opaque', context_digest: digest }),
  };
};

describe('C7 host candidate authority', () => {
  it('should reject an unknown candidate before commitPending or lifecycle effects', async () => {
    const h = host();
    expect(await h.store.commitPending(pending)).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(await h.store.applyLifecycle(lifecycle)).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.transition).not.toHaveBeenCalled();
  });

  it('should bind through the private engine seal callback without changing sealed bytes or store identity', async () => {
    const h = host();
    expect(await h.capture()).toEqual({ ok: true, value: sealed });
    expect(h.store).toBe(h.rawStore);
    expect((await h.store.commitPending(pending)).ok).toBe(true);
    expect((await h.store.applyLifecycle(lifecycle)).ok).toBe(true);
    expect(h.commit).toHaveBeenCalledExactlyOnceWith(pending);
    expect(h.transition).toHaveBeenCalledExactlyOnceWith(lifecycle);
  });

  it.each(['invocationId', 'storeId', 'scopeRef'] as const)('should reject foreign %s before any effect', async (key) => {
    const h = host();
    await h.capture();
    h.enter({ ...h.original, [key]: 'foreign' });
    expect((await h.store.commitPending(pending)).ok).toBe(false);
    expect((await h.store.applyLifecycle(lifecycle)).ok).toBe(false);
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.transition).not.toHaveBeenCalled();
  });

  it('should refuse copied caller assertions and repeated candidate issuance', async () => {
    const h = host();
    await h.capture();
    h.enter({ ...h.original });
    expect((await h.store.commitPending(pending)).ok).toBe(false);
    h.enter(h.original);
    expect((await h.capture()).ok).toBe(false);
    expect(h.seal).toHaveBeenCalledTimes(1);
    expect(h.commit).not.toHaveBeenCalled();
  });
});
