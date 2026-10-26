import type { CanonicalMemoryStorePort, CryptoPort } from '@sentropic/engram/memory-substrate';
import { describe, expect, it, vi } from 'vitest';
import { bindHostCandidateScope, type HostInvocation } from './host-scope-binding.js';
import { g1ScopeBinding, G1_STORE_ID } from './g1-host.js';

const digest = `sha256:${'a'.repeat(64)}` as const;
const sealed = {
  candidate_id: 'candidate-1', envelope_ref: 'envelope-1', envelope_digest: digest,
  key_ref: 'key-1', ciphertext: 'opaque sealed bytes',
};
const event: Parameters<CanonicalMemoryStorePort['commitPending']>[0]['capture_event'] = {
  schema_version: 2, event_id: 'capture-event-1', cursor: '0', recorded_at: '2026-10-26T12:00:00.000Z',
  operation: 'capture', candidate_id: 'candidate-1', to_state: 'pending',
  authorization_receipt_digest: digest, previous_event_digest: digest, event_digest: digest,
};
const pending: Parameters<CanonicalMemoryStorePort['commitPending']>[0] = {
  control: { candidate_id: 'candidate-1', envelope_digest: digest, state: 'pending' as const,
    created_cursor: '0', policy_id: 'policy-1', policy_version: '1' },
  sealed,
  capture_event: event,
};
const lifecycle: Parameters<CanonicalMemoryStorePort['applyLifecycle']>[0] = {
  command: { candidate_id: 'candidate-1', operation: 'reject', event_id: 'reject-event-1', reason_ref: 'reason-1',
    authorization: { credential: 'host-credential' }, deadline_at: '2026-10-26T13:00:00.000Z',
    event_anchor: { occurred_at: event.recorded_at, kind_ref: 'kind-1', provenance_ref: 'provenance-1', provenance_digest: digest } },
  event: { ...event, event_id: 'reject-event-1', operation: 'reject', to_state: 'rejected' },
  projection_batch: { from_cursor_exclusive: '0', through_cursor_inclusive: '1', records: [], removals: [], batch_digest: digest },
};

const host = (binding = g1ScopeBinding()) => {
  const original: HostInvocation = Object.freeze({ invocationId: 'invocation-1', storeId: G1_STORE_ID, scopeRef: G1_STORE_ID });
  let current: HostInvocation | null = original;
  const commit = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const transition = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const seal = vi.fn().mockResolvedValue({ ok: true, value: sealed });
  const admission = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const complete = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const read = vi.fn().mockResolvedValue({ ok: true, value: {} });
  const store = { commitPending: commit, applyLifecycle: transition, applyAdmission: admission,
    readPending: read, recordCaptureIdempotency: complete } as unknown as CanonicalMemoryStorePort;
  const crypto = { version: 1, seal } as unknown as CryptoPort;
  const bound = bindHostCandidateScope({ store, crypto, binding, currentInvocation: () => current });
  return { ...bound, original, commit, transition, seal, admission, complete, read, rawStore: store,
    enter: (invocation: HostInvocation | null) => { current = invocation; },
    // Host-private engine dependency: application callers never receive this callback.
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

  it('should refuse reused commit and lifecycle effects, including concurrent submissions', async () => {
    const h = host();
    await h.capture();
    const results = await Promise.all([h.store.commitPending(pending), h.store.commitPending(pending)]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect((await h.store.applyLifecycle(lifecycle)).ok).toBe(true);
    expect((await h.store.applyLifecycle(lifecycle)).ok).toBe(false);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.transition).toHaveBeenCalledTimes(1);
  });

  it('should reserve candidate issuance before an asynchronous crypto call', async () => {
    const h = host();
    const results = await Promise.all([h.capture(), h.capture()]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(h.seal).toHaveBeenCalledTimes(1);
  });

  it('should reject mismatched candidate identities and substituted envelopes before delegation', async () => {
    const h = host();
    await h.capture();
    for (const input of [
      { ...pending, sealed: { ...sealed, candidate_id: 'foreign' } },
      { ...pending, sealed: { ...sealed, ciphertext: 'substitution' } },
      { ...pending, capture_event: { ...pending.capture_event, candidate_id: 'foreign' } },
    ]) expect((await h.store.commitPending(input)).ok).toBe(false);
    expect(h.commit).not.toHaveBeenCalled();
    expect((await h.store.commitPending(pending)).ok).toBe(true);
    expect((await h.store.applyLifecycle({ ...lifecycle, event: { ...lifecycle.event, candidate_id: 'foreign' } })).ok).toBe(false);
    expect(h.transition).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'foreign', 'throwing'] as const)('should refuse %s scope resolution before crypto effects', async (kind) => {
    const h = host({ ...g1ScopeBinding(), resolveScope: () => {
      if (kind === 'throwing') throw new Error('resolver unavailable');
      return kind === 'unknown' ? null : { tenantId: 'foreign', workspaceId: 'foreign' };
    } });
    expect((await h.capture()).ok).toBe(false);
    expect(h.seal).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('should refuse a missing invocation and scope revocation after sealing', async () => {
    let allowed = true;
    const binding = g1ScopeBinding();
    const h = host({ ...binding, resolveScope: (ref) => allowed ? binding.resolveScope(ref) : null });
    h.enter(null);
    expect((await h.capture()).ok).toBe(false);
    expect(h.seal).not.toHaveBeenCalled();
    h.enter(h.original);
    await h.capture();
    allowed = false;
    expect((await h.store.commitPending(pending)).ok).toBe(false);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('should not reconstruct authority from a caller DTO or another host ledger', async () => {
    const owner = host();
    await owner.capture();
    const stranger = host();
    expect((await stranger.store.commitPending({ ...pending, scope_ref: G1_STORE_ID } as typeof pending)).ok).toBe(false);
    expect((await stranger.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: digest })).ok).toBe(false);
    expect((await stranger.store.readPending({ candidate_id: 'candidate-1', authorization_receipt_digest: digest })).ok).toBe(false);
    expect(stranger.commit).not.toHaveBeenCalled();
    expect(stranger.complete).not.toHaveBeenCalled();
    expect(stranger.read).not.toHaveBeenCalled();
  });

  it('should refuse admission effects for unknown, foreign, mismatched and spent candidates', async () => {
    const h = host();
    const input: Parameters<CanonicalMemoryStorePort['applyAdmission']>[0] = {
      outcome: 'reject', candidate_id: 'candidate-1', scope_ref: G1_STORE_ID,
      decision: { policy_id: 'policy-1', policy_version: '1', record_digest: digest,
        decision: 'reject', issued_at: event.recorded_at, receipt_digest: digest },
      event: { ...event, operation: 'reject', to_state: 'rejected' },
    };
    expect((await h.store.applyAdmission(input)).ok).toBe(false);
    await h.capture();
    await h.store.commitPending(pending);
    h.enter({ ...h.original });
    expect((await h.store.applyAdmission(input)).ok).toBe(false);
    expect((await h.store.readPending({ candidate_id: 'candidate-1', authorization_receipt_digest: digest })).ok).toBe(false);
    expect((await h.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: digest })).ok).toBe(false);
    h.enter(h.original);
    expect((await h.store.applyAdmission({ ...input, scope_ref: 'foreign' })).ok).toBe(false);
    expect((await h.store.applyAdmission({ ...input, event: { ...input.event, candidate_id: 'foreign' } })).ok).toBe(false);
    expect(h.admission).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    const results = await Promise.all([h.store.applyAdmission(input), h.store.applyAdmission(input)]);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect((await h.store.applyLifecycle(lifecycle)).ok).toBe(false);
    expect(h.admission).toHaveBeenCalledExactlyOnceWith(input);
    expect(h.transition).not.toHaveBeenCalled();
  });

  it('should refuse authority changed while sealing and reserve failed commits against reuse', async () => {
    const h = host();
    h.seal.mockImplementationOnce(async () => {
      h.enter({ ...h.original });
      return { ok: true, value: sealed };
    });
    expect((await h.capture()).ok).toBe(false);
    h.enter(h.original);
    expect((await h.store.commitPending(pending)).ok).toBe(false);
    expect(h.commit).not.toHaveBeenCalled();
    const failed = host();
    await failed.capture();
    failed.commit.mockRejectedValueOnce(new Error('ambiguous commit'));
    await expect(failed.store.commitPending(pending)).rejects.toThrow('ambiguous commit');
    expect((await failed.store.commitPending(pending)).ok).toBe(false);
    expect((await failed.store.applyLifecycle(lifecycle)).ok).toBe(false);
    expect(failed.commit).toHaveBeenCalledTimes(1);
    expect(failed.transition).not.toHaveBeenCalled();
  });
});
