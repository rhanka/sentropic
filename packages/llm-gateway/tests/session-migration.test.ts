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

  it('carries the account pin when migrating a previously used session so inference and restart keep serving', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { startGatewayHost } = await import('../src/node/gateway-host.js');
    const { createGatewayControlClient } = await import('../src/node/control-client.js');
    const { durableHostFixture, model, routingContract } = await import('./helpers/durable-host.js');
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-mig-pinned-'));
    const fixture = durableHostFixture();
    let host = await startGatewayHost({ stateDir, mesh: fixture.mesh, listen: { host: '127.0.0.1', port: 0 } });
    try {
      let control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c-pinned', routingContract });
      const send = () => fetch(`${host.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect((await send()).status).toBe(200);
      expect(fixture.calls).toHaveLength(1);
      const nextContract = { ...routingContract, revision: 'p2' };
      const migrated = await control.migrateSessionPolicy({ ownerScopeRef: 'owner-a', sessionRef: issued.sessionRef, routingContract: nextContract, expectedPolicyRevision: 'p1' });
      expect(migrated).toMatchObject({ sessionRef: issued.sessionRef, policyRevision: 'p2', expiresAt: issued.expiresAt });
      expect((await send()).status).toBe(200);
      expect(fixture.calls).toHaveLength(2);

      await host.stop();
      host = await startGatewayHost({ stateDir, mesh: fixture.mesh, listen: { host: '127.0.0.1', port: 0 } });
      control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const reacquired = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c-pinned', routingContract: nextContract });
      expect(reacquired).toMatchObject({
        sessionRef: issued.sessionRef,
        key: issued.key,
        expiresAt: issued.expiresAt,
        policyRevision: 'p2',
        reacquired: true,
      });
      expect((await send()).status).toBe(200);
      expect(fixture.calls).toHaveLength(3);

      const unauthorizedContract = { ...routingContract, revision: 'p3', authorizedAccountRefs: ['internal-b'] };
      await control.migrateSessionPolicy({
        ownerScopeRef: 'owner-a',
        sessionRef: issued.sessionRef,
        routingContract: unauthorizedContract,
        expectedPolicyRevision: 'p2',
      });
      expect((await send()).status).toBe(503);
      expect(fixture.calls).toHaveLength(3);

      const unpinned = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c-unpinned', routingContract: unauthorizedContract });
      await control.migrateSessionPolicy({ ownerScopeRef: 'owner-a', sessionRef: unpinned.sessionRef, routingContract: nextContract, expectedPolicyRevision: 'p3' });
      const resUnpinned = await fetch(`${host.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${unpinned.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(resUnpinned.status).toBe(200);
      expect(fixture.calls).toHaveLength(4);
    } finally {
      await host.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  });
  it('serves real host inference with migrated keys and upgrades policyless legacy sessions while rejecting unapproved policy changes', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { FileGatewayStateStore } = await import('../src/node/gateway-state-store.js');
    const { startGatewayHost } = await import('../src/node/gateway-host.js');
    const { createGatewayControlClient } = await import('../src/node/control-client.js');
    const { durableHostFixture, model, routingContract } = await import('./helpers/durable-host.js');
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-mig-host-'));
    const fixture = durableHostFixture();
    const preService = new GatewaySessionService(new FileGatewayStateStore({ stateDir, keyring: fixture.mesh.keyring }));
    const [readyKey, legacyKey, expiry] = ['M'.repeat(43), 'L'.repeat(43), new Date(Date.now() + 86_400_000).toISOString()];
    const migrated = await migrateOldSessions({
      service: preService,
      entries: [
        oldEntry({ workspaceRef: 'w', clientSessionRef: 'c-ready', keyMaterial: readyKey, expiresAt: expiry, models: [model], routingContract }),
        oldEntry({ workspaceRef: 'w', clientSessionRef: 'c-legacy', keyMaterial: legacyKey, expiresAt: expiry, models: [model] }),
      ],
    });
    expect(migrated.imported).toHaveLength(2);
    const host = await startGatewayHost({ stateDir, mesh: fixture.mesh, listen: { host: '127.0.0.1', port: 0 } });
    try {
      const send = (key: string) => fetch(`${host.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect((await send(readyKey)).status).toBe(200);
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const reacquired = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c-ready', routingContract });
      expect(reacquired).toMatchObject({ key: readyKey, expiresAt: expiry, reacquired: true });
      expect((await send(legacyKey)).status).toBe(401);
      await expect(
        control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c-legacy', routingContract }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        control.migrateSessionPolicy({ ownerScopeRef: 'owner-a', sessionRef: migrated.imported[1]!, routingContract: { ...routingContract, exactModels: ['unapproved-model'] } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const upgraded = await control.migrateSessionPolicy({ ownerScopeRef: 'owner-a', sessionRef: migrated.imported[1]!, routingContract });
      expect(upgraded).toMatchObject({ expiresAt: expiry, policyRevision: routingContract.revision });
      expect((await send(legacyKey)).status).toBe(200);
    } finally {
      await host.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
