import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { createLiveWorkerBridge } from '../../../src/services/artifacts/live/bridge';
import { podName } from '../../../src/services/artifacts/live/pods';

const keys = ['a', 'b', 'c', 'd'].map(id => ({ storageScopeId: 'scope-a', artifactId: `artifact-${id}` }));
const oomKill = (f: ReturnType<typeof fixture>, k = key) => { f.objects.get('pods' + podName(k))!.status = { phase: 'Failed' }; };
const restored = (f: ReturnType<typeof fixture>) => vi.mocked(f.ports.worker.restore).mock.calls.at(-1)![1].revision;

describe('live OOM safety: drafts are durable before ACK', () => {
  it('should revive an OOM-killed pod with the last acknowledged revision', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    f.draft().revision = 'r2'; await f.controller.project(key, 'r2'); // the package ACKed r2 once it was durable
    oomKill(f); await f.controller.reconcile(key);
    const runtime = (await f.state())!.runtime;
    expect(runtime).toMatchObject({ phase: 'LIVE', sourceRevision: 'r2', appliedRevision: 'r2', crashRestores: 1 });
    expect(runtime.podUid).not.toBe(live.podUid); expect(runtime.sessionId).not.toBe(live.sessionId);
    expect(restored(f)).toBe('r2'); expect(f.draft()).toMatchObject({ revision: 'r2', dirty: true });
    expect(f.ports.worker.build).not.toHaveBeenCalled(); expect(f.published).toEqual([]);
  });
  it('should restore one of four packed sessions without touching the other three', async () => {
    const f = fixture({ capacity: 4 }); const lives = [];
    for (const [i, k] of keys.entries()) { f.draft(k).revision = `r-${i}`; lives.push(await f.controller.start(k)); }
    oomKill(f, keys[2]); for (const k of keys) await f.controller.reconcile(k);
    const after = await Promise.all(keys.map(k => f.state(k)));
    expect(after.map(s => s!.runtime.appliedRevision)).toEqual(['r-0', 'r-1', 'r-2', 'r-3']);
    expect(after[0]!.runtime.podUid).toBe(lives[0].podUid); expect(after[1]!.runtime.podUid).toBe(lives[1].podUid); expect(after[3]!.runtime.podUid).toBe(lives[3].podUid);
    expect(after[2]!.runtime.podUid).not.toBe(lives[2].podUid);
  });
  it('should stop automatic restores after two consecutive crashes and revive on the next package projection', async () => {
    const f = fixture(); await f.controller.start(key);
    for (let crash = 0; crash < 3; crash++) { oomKill(f); await f.controller.reconcile(key); }
    expect((await f.state())!.runtime).toMatchObject({ phase: 'DORMANT', crashRestores: 2, stateDetail: 'builder_unavailable' });
    const session = { liveSessionId: 'package-session', leaseEpoch: 1, routeEpoch: 1 };
    const bridge = createLiveWorkerBridge({ controller: f.controller, ports: f.ports, packageRuntime: async () => session });
    await expect(bridge.reconcile({ ...key, bindingGeneration: 1 })).resolves.toMatchObject({ revision: 'r1', ready: true });
    expect((await f.state())!.runtime).toMatchObject({ phase: 'LIVE', crashRestores: 0 });
  });
  it('should not start a replacement while the killed pod deletion is unconfirmed', async () => {
    const f = fixture(); await f.controller.start(key); const created = vi.mocked(f.core.create).mock.calls.length;
    f.core.waitDeleted = vi.fn(async () => { throw new Error('unconfirmed'); });
    oomKill(f); await f.controller.reconcile(key);
    expect((await f.state())!.runtime.phase).toBe('RECOVERING'); expect(f.core.create).toHaveBeenCalledTimes(created);
    expect(f.draft().revision).toBe('r1');
  });
});
