/**
 * Durable request receipts (L1, spec 6.1/6.2).
 *
 * Every attempt links its session, requested model, and terminal settlement;
 * receipts survive restart, stay owner-isolated, and carry no secrets.
 * In-flight requests that never settle stay `pending`, never replayed.
 */
import { describe, expect, it } from 'vitest';

import { GatewaySessionService } from '../src/session-service.js';
import type { GatewayStateStore, StoredState } from '../src/ports/gateway-state.js';

const liveStore = () => {
  let current: StoredState = { schemaVersion: 1, revision: 0, sessions: {}, receipts: {} };
  const store: GatewayStateStore = {
    load: async () => structuredClone(current),
    compareAndSet: async (expected, next) => {
      if (expected !== current.revision) throw new Error('CONFLICT');
      current = structuredClone(next);
      return { revision: current.revision };
    },
  };
  return store;
};

describe('request receipts', () => {
  it('links attempts to their session and settles terminally', async () => {
    const service = new GatewaySessionService(liveStore());
    const issued = await service.acquireSession({
      ownerScopeRef: 'owner-a',
      workspaceRef: 'w',
      clientSessionRef: 'c',
      models: ['muse-spark-1.3', 'm'],
    });
    const first = await service.recordAttempt({
      ownerScopeRef: 'owner-a',
      sessionRef: issued.sessionRef,
      requestId: 'req-1',
      model: 'muse-spark-1.3',
    });
    expect(first.settlement).toBe('pending');
    const settled = await service.settleReceipt({
      ownerScopeRef: 'owner-a',
      receiptId: first.receiptId,
      outcome: 'stop',
    });
    expect(settled.settledAt).toBeDefined();
    expect((await service.readReceipt({ ownerScopeRef: 'owner-a', receiptId: first.receiptId })).settlement).toBe('stop');
    await expect(
      service.settleReceipt({ ownerScopeRef: 'owner-a', receiptId: first.receiptId, outcome: 'stop' }),
    ).rejects.toMatchObject({ code: 'ALREADY-SETTLED' });
    const pending = await service.recordAttempt({
      ownerScopeRef: 'owner-a',
      sessionRef: issued.sessionRef,
      requestId: 'req-2',
      model: 'm',
    });
    await expect(
      service.settleReceipt({ ownerScopeRef: 'owner-a', receiptId: pending.receiptId, outcome: 'teleport' }),
    ).rejects.toMatchObject({ code: 'BAD-SETTLEMENT' });
  });

  it('isolates receipts by owner and survives restart', async () => {
    const store = liveStore();
    const service = new GatewaySessionService(store);
    const issued = await service.acquireSession({
      ownerScopeRef: 'owner-a',
      workspaceRef: 'w',
      clientSessionRef: 'c',
      models: ['m'],
    });
    const receipt = await service.recordAttempt({
      ownerScopeRef: 'owner-a',
      sessionRef: issued.sessionRef,
      requestId: 'req-1',
      model: 'm',
    });
    await expect(
      service.readReceipt({ ownerScopeRef: 'owner-b', receiptId: receipt.receiptId }),
    ).rejects.toMatchObject({ code: 'NOT-FOUND' });
    const restarted = new GatewaySessionService(store);
    const read = await restarted.readReceipt({ ownerScopeRef: 'owner-a', receiptId: receipt.receiptId });
    expect(read.requestId).toBe('req-1');
    expect(read.settlement).toBe('pending');
    await restarted.reconcilePending();
    expect((await restarted.readReceipt({ ownerScopeRef: 'owner-a', receiptId: receipt.receiptId })).settlement).toBe('incomplete');
  });
});
