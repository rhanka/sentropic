import { describe, expect, it } from 'vitest';
import { createCustodyAuthority } from '../../src/services/artifacts/live/execution-node-rpc';
import type { LiveRuntime } from '../../src/services/artifacts/live/records';
import { session } from './execution-node-fake';

function authorityFixture() {
  const key = { storageScopeId: 'workspace', artifactId: 'artifact' };
  const runtime = { ...key, phase: 'LIVE', ownerId: 'principal', sessionId: 'session', generation: 1,
    routeEpoch: 1, podUid: 'physical', podName: 'pod', appliedRevision: 'revision',
    rowVersion: 1, lastAccessAt: 0 } as LiveRuntime;
  const allocation = { ...session(), physicalUid: 'physical' };
  const route = { ...key, sessionId: runtime.sessionId, generation: 1, routeEpoch: 1,
    podUid: 'physical', podName: 'pod', sourceRevision: 'revision', principalId: 'principal', expiresAt: 5000 };
  let afterRead = () => {};
  const resolve = createCustodyAuthority({ store: { read: async () => ({ runtime: structuredClone(runtime) }) as never,
    active: async () => [] }, binding: async () => ({ ownerId: runtime.ownerId, generation: runtime.generation }),
    invitations: { current: async () => ({ epoch: 1, expiresAt: null }) }, now: () => 1000,
    session: async () => { afterRead(); return structuredClone(allocation); } });
  return { runtime, allocation, route, resolve: () => resolve({ kind: 'live', route }),
    duringRead(work: () => void) { afterRead = work; } };
}
describe('custody authority projection', () => {
  it('should allow activity racing node I/O without changing watch authority', async () => {
    const f = authorityFixture(); const before = await f.resolve();
    f.duringRead(() => { f.runtime.lastAccessAt++; f.runtime.rowVersion++; });
    expect((await f.resolve()).version).toBe(before.version);
  });
  it.each(['ownerId', 'sessionId', 'generation', 'routeEpoch', 'podUid', 'appliedRevision'] as const)(
    'should refuse authority change %s racing node I/O', async field => {
      const f = authorityFixture();
      f.duringRead(() => { Object.assign(f.runtime, { [field]: typeof f.runtime[field] === 'number' ? 2 : 'changed' }); });
      await expect(f.resolve()).rejects.toThrow('custody_revoked');
    });
  it.each(['owner', 'session', 'generation', 'route fence', 'physical UID', 'custody epoch', 'expiry'])(
    'should change the version when valid %s authority changes', async field => {
      const f = authorityFixture(); const before = await f.resolve();
      if (field === 'owner') {
        f.runtime.ownerId = 'new-owner'; f.route.principalId = 'new-owner';
        f.allocation.ownership = { ...f.allocation.ownership, principalId: 'new-owner' };
      }
      if (field === 'session') {
        f.runtime.sessionId = f.route.sessionId = 'new-session';
        f.allocation.ownership = { ...f.allocation.ownership, sessionId: 'new-session' };
      }
      if (field === 'generation') {
        f.runtime.generation = f.route.generation = 2;
        f.allocation.ownership = { ...f.allocation.ownership, generation: 2 };
      }
      if (field === 'route fence') f.runtime.routeEpoch = f.route.routeEpoch = 2;
      if (field === 'physical UID') f.runtime.podUid = f.route.podUid = f.allocation.physicalUid = 'new-physical';
      if (field === 'custody epoch') f.allocation.ownership = { ...f.allocation.ownership, custodyEpoch: 2 };
      if (field === 'expiry') f.route.expiresAt--;
      expect((await f.resolve()).version).not.toBe(before.version);
    });
});
