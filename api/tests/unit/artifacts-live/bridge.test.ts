import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { createLiveWorkerBridge } from '../../../src/services/artifacts/live/bridge';

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
    await expect(bridge.reconcile(identity)).resolves.toMatchObject({ ready: false });
  });
  it('should stop through the controller teardown for the matching session only', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    await expect(bridge.stop({ ...identity, ...session, liveSessionId: 'other' })).rejects.toMatchObject({ reason: 'stale_session' });
    await bridge.stop({ ...identity, ...session, });
    expect((await f.state())?.runtime.phase).toBe('DORMANT');
  });
  it('should refuse a stop from a stale lease epoch of the same package session', async () => {
    const f = fixture(); const bridge = bridgeOf(f); await bridge.reconcile(identity);
    await expect(bridge.stop({ ...identity, ...session, leaseEpoch: 6 })).rejects.toMatchObject({ reason: 'stale_session' });
    expect((await f.state())?.runtime.phase).toBe('LIVE');
  });
});
