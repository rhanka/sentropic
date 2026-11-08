import { describe, expect, it, vi } from 'vitest';
import { fixture, key, owner } from './fixture';
import { LiveError, type LiveKey } from '../../../src/services/artifacts/live/records';
import { QUOTA_EXCEEDED, quotaRefusal } from '../../../src/services/artifacts/live/pods';

const keyOf = (i: number): LiveKey => ({ storageScopeId: 'scope-a', artifactId: `artifact-${i}` });
const podCreates = (f: ReturnType<typeof fixture>) => vi.mocked(f.core.create).mock.calls.filter(([kind]) => kind === 'pods').length;
/** Kubernetes refuses the next `count` pod creations with a 403 « exceeded quota » (ResourceQuota tenant-quota). */
function refuseQuota(f: ReturnType<typeof fixture>, count: number) {
  const create = vi.mocked(f.core.create).getMockImplementation()!;
  vi.mocked(f.core.create).mockImplementation(async (kind, value) => {
    if (kind === 'pods' && count-- > 0) throw new LiveError('builder_unavailable', QUOTA_EXCEEDED);
    return create(kind, value);
  });
}

describe('builder pod slots, quota backpressure and no surge (s-archi 07/11 21:15)', () => {
  it('should take a pod slot before every creation and never create a fifth pod', async () => {
    const f = fixture({ capacity: 5, maxPods: 4, maxWaitMs: 5 });
    for (let i = 1; i <= 4; i++) expect((await f.controller.start(keyOf(i))).phase).toBe('LIVE');
    expect(await f.queue.request('d2-4-a', { subject: 'probe', kind: 'pod' }))
      .toMatchObject({ state: 'queued', blockedBy: 'pods' });
    await f.queue.finish('d2-4-a', { subject: 'probe', kind: 'pod' });
    await expect(f.controller.start(keyOf(5))).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    expect(podCreates(f)).toBe(4); expect((await f.state(keyOf(5)))?.runtime.phase).toBe('DORMANT');
    const first = (await f.state(keyOf(1)))!.runtime;
    await f.controller.stop(keyOf(1), { ownerId: owner.principalId, sessionId: first.sessionId, generation: first.generation });
    expect((await f.controller.start(keyOf(5))).phase).toBe('LIVE');
    expect(podCreates(f)).toBe(5); expect((await f.queue.status('d2-4-a')).pods).toHaveLength(4);
  });
  it('should treat a 403 exceeded quota on pod create as backpressure: requeue, retry, then LIVE', async () => {
    const f = fixture(); refuseQuota(f, 2);
    const runtime = await f.controller.start(key);
    expect(runtime.phase).toBe('LIVE'); expect(podCreates(f)).toBe(3);
    // No teardown ran: the refusal never failed the session.
    expect(f.events).not.toContain('revoke'); expect(f.events).not.toContain('quiesce');
    expect((await f.queue.status('d2-4-a')).pods).toEqual([runtime.podName]);
  });
  it('should publish a build-only job after quota refusals instead of failing it', async () => {
    const f = fixture(); refuseQuota(f, 2);
    await f.controller.buildOnly(key, 'job-A');
    expect(f.published).toEqual(['A']); expect(podCreates(f)).toBe(3);
  });
  it('should end a quota wait as a retryable queued refusal, never a final builder_unavailable', async () => {
    const f = fixture({ maxWaitMs: 5 }); refuseQuota(f, Number.POSITIVE_INFINITY);
    await expect(f.controller.start(key)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    expect(await f.queue.status('d2-4-a')).toMatchObject({ pods: [], entries: [] });
  });
  it('should classify only a 403 exceeded quota as a quota refusal', () => {
    expect(quotaRefusal(403, 'pods "artifact-x" is forbidden: exceeded quota: tenant-quota, requested: pods=1')).toBe(true);
    expect(quotaRefusal(403, 'pods "artifact-x" is forbidden: violates PodSecurity "restricted"')).toBe(false);
    expect(quotaRefusal(422, 'exceeded quota')).toBe(false);
  });
  it('should not create a replacement before a terminating older pod is gone (cold revive)', async () => {
    const f = fixture(); const first = await f.controller.start(key);
    const old = structuredClone(f.objects.get('pods' + first.podName)!);
    await f.controller.stop(key, { ownerId: owner.principalId, sessionId: first.sessionId, generation: first.generation });
    // The older lease's pod is still terminating (it counts against the quota until Kubernetes returns 404).
    Object.assign(old.metadata, { deletionTimestamp: '2026-11-07T21:15:00Z' }); f.objects.set('pods' + first.podName, old);
    const order: string[] = []; const create = vi.mocked(f.core.create).getMockImplementation()!;
    vi.mocked(f.core.create).mockImplementation(async (kind, value) => {
      if (kind === 'pods') order.push(f.objects.has('pods' + first.podName) ? 'create:old-present' : 'create');
      return create(kind, value);
    });
    vi.mocked(f.core.waitDeleted).mockImplementation(async (kind, name) => {
      if (!f.objects.has(kind + name)) return;
      order.push('wait'); await new Promise(resolve => setTimeout(resolve, 5)); f.objects.delete(kind + name); order.push('gone');
    });
    vi.mocked(f.core.delete).mockClear();
    const revived = await f.controller.start(key);
    expect(revived.phase).toBe('LIVE'); expect(order).toEqual(['wait', 'gone', 'create']);
    expect(f.core.delete).not.toHaveBeenCalledWith('pods', first.podName, old.metadata.uid);
  });
  it('should not create the crash replacement before the evicted pod is gone (crash_restore)', async () => {
    const f = fixture(); const first = await f.controller.start(key);
    Object.assign(f.objects.get('pods' + first.podName)!.metadata, { deletionTimestamp: '2026-11-07T21:15:00Z' });
    const order: string[] = []; const remove = vi.mocked(f.core.delete).getMockImplementation()!;
    // An evicted pod accepts the DELETE but stays Terminating until Kubernetes returns 404.
    vi.mocked(f.core.delete).mockImplementation(async (kind, name, uid) => {
      order.push(`delete:${kind}`); if (kind !== 'pods') return remove(kind, name, uid);
    });
    vi.mocked(f.core.waitDeleted).mockImplementation(async (kind, name) => {
      if (!f.objects.has(kind + name)) return;
      order.push('wait'); await new Promise(resolve => setTimeout(resolve, 5)); f.objects.delete(kind + name); order.push('gone');
    });
    const create = vi.mocked(f.core.create).getMockImplementation()!;
    vi.mocked(f.core.create).mockImplementation(async (kind, value) => { order.push(`create:${kind}`); return create(kind, value); });
    await f.controller.reconcile(key);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'LIVE', crashRestores: 1 });
    expect(order.filter(step => !step.endsWith(':services'))).toEqual(['delete:pods', 'wait', 'gone', 'create:pods']);
  });
  it('should delete then wait for an older non-terminating pod before creating the replacement (cold revive)', async () => {
    const f = fixture(); const first = await f.controller.start(key);
    const old = structuredClone(f.objects.get('pods' + first.podName)!);
    await f.controller.stop(key, { ownerId: owner.principalId, sessionId: first.sessionId, generation: first.generation });
    f.objects.set('pods' + first.podName, old);
    const order: string[] = []; const remove = vi.mocked(f.core.delete).getMockImplementation()!;
    vi.mocked(f.core.delete).mockImplementation(async (kind, name, uid) => { order.push(`delete:${kind}`); return remove(kind, name, uid); });
    const create = vi.mocked(f.core.create).getMockImplementation()!;
    vi.mocked(f.core.create).mockImplementation(async (kind, value) => { order.push(`create:${kind}`); return create(kind, value); });
    expect((await f.controller.start(key)).phase).toBe('LIVE');
    expect(order.slice(0, 2)).toEqual(['delete:pods', 'create:pods']);
    expect(f.core.waitDeleted).toHaveBeenCalledWith('pods', first.podName, old.metadata.uid);
  });
});
