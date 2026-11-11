import { describe, expect, it } from 'vitest';
import { fixture, key, owner } from './fixture';
import { cacheKeyOf, type CacheIdentity } from '../../../src/services/artifacts/live/cache';

const cacheKey = () => cacheKeyOf({} as CacheIdentity);
/** A filled pool pod for the fixture's sealed identity, with its Kubernetes object present. */
async function seedWarmPod(f: ReturnType<typeof fixture>, uid: string) {
  const filling = await f.ports.pool!.beginFill('scope-a', cacheKey(), 'B');
  f.objects.set('pods' + filling.podName, { metadata: { name: filling.podName, uid,
    labels: {}, creationTimestamp: new Date(0).toISOString() }, spec: {}, status: {} });
  await f.ports.pool!.completeFill('scope-a', cacheKey(), uid);
  return filling.podName;
}

describe('warm pod pool claim and release (L3 §7.3.2)', () => {
  it('should start on a warm pod, release it to warm-deps at stop, and publish from it', async () => {
    const f = fixture();
    const poolPod = await seedWarmPod(f, 'uid-w1');
    const live = await f.controller.start(key);
    expect(live.phase).toBe('LIVE');
    expect(live.podName).toBe(poolPod);
    expect(live.poolEpoch).toBe(0);
    // Warm-hit skips pod creation, clean, dependency materialize and prebundle: only the overlay is restored.
    expect(f.events).toContain('restore');
    expect(f.events).not.toContain('clean');
    expect(f.events).not.toContain('prepare:B');
    expect(await f.ports.pool!.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 1 });
    await f.controller.stop(key, { ownerId: owner.principalId, sessionId: live.sessionId, generation: live.generation });
    // The pod survives the stop: scrubbed, unserviced, marked warm-deps synchronously.
    expect(f.objects.has('pods' + poolPod)).toBe(true);
    expect(f.objects.has('services' + poolPod)).toBe(false);
    expect(await f.ports.pool!.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 1, filling: 0, claimed: 0 });
    // The immediately following publish claims the hot tree: no clean, no prepare, source staged directly.
    await f.controller.buildOnly(key, 'job-A');
    expect(f.published).toEqual(['A']);
    expect(f.events).toContain('stageSource');
    expect(f.events).not.toContain('clean');
    expect(f.objects.has('pods' + poolPod)).toBe(true);
    expect(await f.ports.pool!.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 1, filling: 0, claimed: 0 });
  });
  it('should fall back to the cold path when no warm pod is pooled', async () => {
    const f = fixture();
    const live = await f.controller.start(key);
    expect(live.phase).toBe('LIVE');
    expect(live.podName).not.toMatch(/^artifact-pool-/);
    expect(f.events).toContain('clean');
    expect(f.events).toContain('prepare:B');
  });
  it('should delete the pod when the scrub ACK does not prove the cleared set', async () => {
    const f = fixture();
    const poolPod = await seedWarmPod(f, 'uid-w1');
    const live = await f.controller.start(key);
    // A scrub that clears nothing is scrub doubt (§5.5): the pod is deleted, never pooled.
    f.ports.worker.scrub = (async () => ({ cleared: [], poolEpoch: 1 })) as never;
    await f.controller.stop(key, { ownerId: owner.principalId, sessionId: live.sessionId, generation: live.generation });
    expect(f.objects.has('pods' + poolPod)).toBe(false);
    expect(await f.ports.pool!.occupancy('scope-a')).toEqual({ warm: 0, warmDeps: 0, filling: 0, claimed: 0 });
  });
});
