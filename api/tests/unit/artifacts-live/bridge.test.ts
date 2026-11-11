import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { createLiveWorkerBridge } from '../../../src/services/artifacts/live/bridge';
import { LiveError } from '../../../src/services/artifacts/live/records';

const identity = { ...key, bindingGeneration: 1 };
const session = { liveSessionId: 'package-session', leaseEpoch: 7, routeEpoch: 9 };

function bridgeOf(f: ReturnType<typeof fixture>) {
  return createLiveWorkerBridge({ controller: f.controller, ports: f.ports, packageRuntime: vi.fn(async () => session) });
}

describe('live worker bridge (package LiveService <-> controller)', () => {
  it('should revive a dormant binding and ACK the exact string revision', async () => {
    const f = fixture(); const ack = await bridgeOf(f).reconcile(identity);
    expect(ack).toEqual({ ...session, revision: 'r1', ready: true });
    expect((await f.state())?.runtime).toMatchObject({ phase: 'LIVE', sourceRevision: 'r1', appliedRevision: 'r1' });
  });
  it('should project a newer durable revision on a live worker', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    f.draft().revision = 'r2'; const ack = await bridge.reconcile(identity);
    expect(ack).toMatchObject({ revision: 'r2', ready: true });
  });
  it('should wake an idle build attempt before projecting the edit', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    const state = (await f.state())!; await f.ports.store.transaction(key, async unit => {
      unit.state!.runtime.phase = 'BUILDING'; unit.save(unit.state!); return state; });
    f.draft().revision = 'r2'; f.events.length = 0;
    const ack = await bridge.reconcile(identity);
    expect(f.events).toContain('quiesce'); expect(ack).toMatchObject({ revision: 'r2', ready: true });
    expect((await f.state())?.runtime.phase).toBe('LIVE');
  });
  it('should stay pending without throwing when the draft moved during projection', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    f.draft().revision = 'r2';
    vi.mocked(f.ports.worker.live).mockImplementationOnce(async runtime => {
      f.draft().revision = 'r3'; return { revision: runtime.sourceRevision, routeEpoch: runtime.routeEpoch }; });
    const ack = await bridge.reconcile(identity);
    expect(ack).toMatchObject({ ready: false }); expect(ack).not.toHaveProperty('failure');
  });
  it('should stop through the controller teardown for the matching session', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    await bridge.stop({ ...identity, ...session });
    expect((await f.state())?.runtime.phase).toBe('DORMANT');
  });
  it('should total-stop without touching the runtime on a stop for another session', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    await bridge.stop({ ...identity, ...session, liveSessionId: 'other' });
    expect((await f.state())?.runtime.phase).toBe('LIVE');
    await bridge.stop({ ...identity, ...session });
    expect((await f.state())?.runtime.phase).toBe('DORMANT');
  });
  it('should total-stop without touching the runtime on a stop from a stale lease epoch', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    await bridge.stop({ ...identity, ...session, leaseEpoch: 6 });
    expect((await f.state())?.runtime.phase).toBe('LIVE');
  });
  it('should total-stop when the builder holds no fences for the session', async () => {
    const f = fixture(); await bridgeOf(f).reconcile(identity);
    const unfenced = createLiveWorkerBridge({ controller: f.controller, ports: f.ports,
      packageRuntime: vi.fn(async () => { throw new LiveError('git_live_conflict', 'stale_session'); }) });
    await unfenced.stop({ ...identity, ...session });
    expect((await f.state())?.runtime.phase).toBe('LIVE');
  });
  it('should still throw when the fences cannot be read for another reason', async () => {
    const f = fixture();
    const broken = createLiveWorkerBridge({ controller: f.controller, ports: f.ports,
      packageRuntime: vi.fn(async () => { throw new Error('rows unreachable'); }) });
    await expect(broken.stop({ ...identity, ...session })).rejects.toThrow('rows unreachable');
  });
  it('should ACK the typed failure when the builder abandons the revive', async () => {
    const f = fixture(); const bridge = bridgeOf(f);
    vi.mocked(f.ports.worker.prepare).mockRejectedValueOnce(
      new LiveError('builder_unavailable', 'phase_timeout:install:drain'));
    const ack = await bridge.reconcile(identity);
    expect(ack).toMatchObject({ revision: 'r1', ready: false,
      failure: { code: 'builder_unavailable', reason: 'phase_timeout:install:drain' } });
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT',
      stateDetail: 'builder_unavailable:phase_timeout:install:drain' });
  });
  it('should still throw fence conflicts without a failure ACK', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    f.binding.generation = 2;
    await expect(bridge.reconcile(identity)).rejects.toMatchObject({ code: 'git_live_conflict', reason: 'stale_fence' });
  });
});
