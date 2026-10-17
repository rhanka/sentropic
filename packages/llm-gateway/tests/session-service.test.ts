/**
 * Gateway-owned durable sessions (L1, spec 6.2).
 *
 * One published session service over a versioned compare-and-set store: the
 * issuer publishes a new key only after durable commit, a crash before
 * commit leaves no issued key, and authenticated idempotent reacquisition
 * returns the same session without reissuing key material.
 */
import { describe, expect, it } from 'vitest';

import {
  GatewaySessionError,
  GatewaySessionService,
  type GatewayStateStore,
  type StoredState,
} from '../src/session-service.js';

const state = (overrides: Partial<StoredState> = {}): StoredState => ({
  schemaVersion: 1,
  revision: 0,
  sessions: {},
  receipts: {},
  ...overrides,
});

const memoryStore = (initial: StoredState = state(), hooks: { failCommit?: boolean; corrupt?: boolean } = {}) => {
  let current = structuredClone(initial);
  let commits = 0;
  const store: GatewayStateStore & { commits: () => number } = {
    commits: () => commits,
    load: async () => {
      if (hooks.corrupt) throw new GatewaySessionError('store corrupt (quarantined)', 'CORRUPT');
      return structuredClone(current);
    },
    compareAndSet: async (expectedRevision, next) => {
      if (hooks.failCommit) throw new GatewaySessionError('durable commit failed', 'STORE-FAILED');
      if (expectedRevision !== current.revision) {
        throw new GatewaySessionError('concurrent write', 'CONFLICT');
      }
      commits += 1;
      current = structuredClone(next);
      return { revision: current.revision };
    },
  };
  return store;
};

const acquireInput = (overrides = {}) => ({
  ownerScopeRef: 'owner-a',
  workspaceRef: 'workspace-a',
  clientSessionRef: 'client-1',
  ...overrides,
});

describe('GatewaySessionService', () => {
  it('issues a 256-bit key once, after durable commit', async () => {
    const store = memoryStore();
    const service = new GatewaySessionService(store);
    const issued = await service.acquireSession(acquireInput());
    expect(issued.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.commits()).toBe(1);
    expect(issued.sessionRef.length).toBeGreaterThan(0);
  });

  it('returns one committed session for concurrent acquisitions (no double issue)', async () => {
    const store = memoryStore();
    const service = new GatewaySessionService(store);
    const [first, second] = await Promise.all([
      service.acquireSession(acquireInput()),
      service.acquireSession(acquireInput()),
    ]);
    expect(first.sessionRef).toBe(second.sessionRef);
    const keys = [first.key, second.key].filter(Boolean);
    expect(keys).toHaveLength(1);
  });

  it('refuses unauthenticated acquisition and cross-owner key use without an oracle', async () => {
    const store = memoryStore();
    const service = new GatewaySessionService(store);
    await expect(service.acquireSession({ ...acquireInput(), ownerScopeRef: '' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const issued = await service.acquireSession(acquireInput());
    await expect(
      service.resolveCaller({ sessionRef: issued.sessionRef, key: 'AAAA-invalid-key' }),
    ).rejects.toMatchObject({ code: 'INVALID-KEY' });
    await expect(
      service.resolveCaller({ sessionRef: 'no-such-session', key: 'AAAA-invalid-key' }),
    ).rejects.toMatchObject({ code: 'INVALID-KEY' });
  });

  it('resolves the owner context with a valid key and lists no key material', async () => {
    const store = memoryStore();
    const service = new GatewaySessionService(store);
    const issued = await service.acquireSession(acquireInput());
    const caller = await service.resolveCaller({ sessionRef: issued.sessionRef, key: issued.key as string });
    expect(caller.ownerScopeRef).toBe('owner-a');
    const listed = await service.listSessions({ ownerScopeRef: 'owner-a' });
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(issued.key as string);
    expect(await service.listSessions({ ownerScopeRef: 'owner-b' })).toEqual([]);
  });

  it('keeps revocation and expiry across restart without extending lifetime', async () => {
    const store = memoryStore();
    const first = new GatewaySessionService(store);
    const issued = await first.acquireSession(acquireInput());
    await first.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: issued.sessionRef });
    const restarted = new GatewaySessionService(store);
    await expect(
      restarted.resolveCaller({ sessionRef: issued.sessionRef, key: issued.key as string }),
    ).rejects.toMatchObject({ code: 'REVOKED' });
    const listed = await restarted.listSessions({ ownerScopeRef: 'owner-a' });
    expect(listed[0].expiresAt).toBe(issued.expiresAt);
  });

  it('issues no key when the durable commit fails, and refuses on corrupt stores', async () => {
    const failing = memoryStore(state(), { failCommit: true });
    await expect(new GatewaySessionService(failing).acquireSession(acquireInput())).rejects.toMatchObject({
      code: 'STORE-FAILED',
    });
    expect(failing.commits()).toBe(0);
    const corrupt = memoryStore(state(), { corrupt: true });
    await expect(new GatewaySessionService(corrupt).acquireSession(acquireInput())).rejects.toMatchObject({
      code: 'CORRUPT',
    });
  });

  it('links request receipts to their session without secrets', async () => {
    const store = memoryStore();
    const service = new GatewaySessionService(store);
    const issued = await service.acquireSession(acquireInput());
    const receipt = await service.recordAttempt({
      ownerScopeRef: 'owner-a',
      sessionRef: issued.sessionRef,
      requestId: 'req-1',
      model: 'claude-opus-4-7',
    });
    await service.settleReceipt({ ownerScopeRef: 'owner-a', receiptId: receipt.receiptId, outcome: 'stop' });
    const read = await service.readReceipt({ ownerScopeRef: 'owner-a', receiptId: receipt.receiptId });
    expect(read.sessionRef).toBe(issued.sessionRef);
    expect(read.settlement).toBe('stop');
    expect(JSON.stringify(read)).not.toContain(issued.key as string);
  });
});
