/**
 * Single-writer old-store migration (L1, spec 6.2).
 *
 * A bounded deterministic migration validates each old entry against trusted
 * owner/session metadata, keeps active key bytes stable, durably acknowledges
 * the import, and quarantines invalid or ambiguous entries without
 * cross-binding caller input. The old minting writer stops on the companion;
 * no permanent dual writer remains.
 */
import { describe, expect, it } from 'vitest';

import { GatewaySessionService } from '../src/session-service.js';
import { migrateOldSessions } from '../src/node/session-migration.js';
import type { GatewayStateStore, StoredState } from '../src/ports/gateway-state.js';

const emptyState = (): StoredState => ({
  schemaVersion: 1,
  revision: 0,
  sessions: {},
  receipts: {},
});

const liveStore = () => {
  let current = emptyState();
  const store: GatewayStateStore = {
    load: async () => structuredClone(current),
    compareAndSet: async (expected, next) => {
      if (expected !== current.revision) throw new Error('CONFLICT');
      current = structuredClone(next);
      return { revision: current.revision };
    },
  };
  return { store, current: () => current };
};

const oldEntry = (overrides = {}) => ({
  ownerScopeRef: 'owner-a',
  workspaceRef: 'workspace-a',
  clientSessionRef: 'client-1',
  keyMaterial: 'K'.repeat(43),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  ...overrides,
});

describe('migrateOldSessions', () => {
  it('does not classify a storage outage as invalid imported input', async () => {
    const { store } = liveStore();
    store.compareAndSet = async () => { throw new Error('store unavailable'); };
    await expect(migrateOldSessions({ service: new GatewaySessionService(store), entries: [oldEntry()] })).rejects.toThrow('store unavailable');
    expect((await store.load()).sessions).toEqual({});
    expect((await store.load()).receipts).toEqual({});
  });
  it('imports valid entries with stable key bytes and a durable ack', async () => {
    const { store } = liveStore();
    const service = new GatewaySessionService(store);
    const result = await migrateOldSessions({
      service,
      entries: [oldEntry(), oldEntry({ clientSessionRef: 'client-2', keyMaterial: 'Q'.repeat(43) })],
    });
    expect(result.imported).toHaveLength(2);
    expect(result.quarantined).toEqual([]);
    expect(result.ack.receiptIds).toHaveLength(2);
    const caller = await service.resolveCaller({
      sessionRef: result.imported[0],
      key: 'K'.repeat(43),
    });
    expect(caller.ownerScopeRef).toBe('owner-a');
  });

  it('quarantines short keys, expired entries, and ambiguous duplicates', async () => {
    const { store } = liveStore();
    const service = new GatewaySessionService(store);
    const result = await migrateOldSessions({
      service,
      entries: [
        oldEntry({ clientSessionRef: 'short', keyMaterial: 'tiny' }),
        oldEntry({ clientSessionRef: 'old', expiresAt: new Date(Date.now() - 1000).toISOString() }),
        oldEntry({ clientSessionRef: 'dup', keyMaterial: 'A'.repeat(43) }),
        oldEntry({ clientSessionRef: 'dup', keyMaterial: 'B'.repeat(43) }),
        oldEntry({ ownerScopeRef: '', keyMaterial: 'C'.repeat(43) }),
      ],
    });
    expect(result.imported).toHaveLength(1);
    expect(result.quarantined.map((entry) => entry.reason).sort()).toEqual([
      'ambiguous-duplicate',
      'expired',
      'invalid-owner',
      'short-key',
    ]);
  });

  it('never overwrites a live gateway session (rollback reads gateway records)', async () => {
    const { store } = liveStore();
    const service = new GatewaySessionService(store);
    const live = await service.acquireSession({
      ownerScopeRef: 'owner-a',
      workspaceRef: 'workspace-a',
      clientSessionRef: 'client-1',
    });
    const result = await migrateOldSessions({ service, entries: [oldEntry()] });
    expect(result.imported).toEqual([]);
    expect(result.quarantined[0].reason).toBe('ambiguous-duplicate');
    const caller = await service.resolveCaller({ sessionRef: live.sessionRef, key: live.key as string });
    expect(caller.ownerScopeRef).toBe('owner-a');
  });
});
