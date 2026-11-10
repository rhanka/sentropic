import { describe, expect, it, vi } from 'vitest';
import { fixture, key, placement } from './fixture';
import { builderPod, defaultWorkerSizing, podName, readWorkerSizing } from '../../../src/services/artifacts/live/pods';
import { deleteOptions } from '../../../src/services/artifacts/live/kubernetes';
import { LiveError } from '../../../src/services/artifacts/live/records';
import { BUILDER_IMAGE } from '../../../src/services/artifacts/live/recipes';
import { MAX_BUILDER_PODS } from '../../../src/services/artifacts/live/service';
import { PRODUCT_HEAVY } from '../../../src/services/artifacts/live/product-builder';

describe('builder pod admission and recovery', () => {
  it('should emit the exact VAP/PSA manifest without credentials or persistent volumes', async () => {
    const f = fixture(); const runtime = await f.controller.start(key); const pod = builderPod(key, runtime, 'trusted', placement);
    expect(pod.spec).toMatchObject({ serviceAccountName: 'artifact-builder', automountServiceAccountToken: false,
      restartPolicy: 'Never', securityContext: { runAsNonRoot: true } });
    expect(pod.spec).not.toHaveProperty('activeDeadlineSeconds');
    expect(pod.spec.containers).toHaveLength(1); expect(pod.spec.containers[0].image).toBe(BUILDER_IMAGE);
    expect(pod.spec.containers[0].securityContext).toMatchObject({ allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
    expect(pod.spec.nodeSelector).toEqual({ nodepool: 'artifact-builders' });
    expect(pod.spec.tolerations).toEqual([{ key: 'sentropic.dev/pool', operator: 'Equal', value: 'artifact-builders', effect: 'NoExecute' }]);
    const res = pod.spec.containers[0].resources;
    expect(res.requests).toEqual({ cpu: '250m', memory: '1280Mi', 'ephemeral-storage': '0' });
    expect(res.limits).toEqual({ cpu: '1', memory: '1536Mi', 'ephemeral-storage': '3400Mi' });
    expect(pod.spec.containers[0].env).toContainEqual({ name: 'NODE_OPTIONS', value: '--max-old-space-size=384' });
    expect(pod.spec.containers[0].env).toContainEqual({ name: 'ARTIFACT_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } });
    expect(pod.spec.containers[0].env.filter(entry => 'valueFrom' in entry)).toHaveLength(1);
    expect(pod.spec.volumes).toEqual([{ name: 'source', emptyDir: { sizeLimit: '384Mi' } },
      { name: 'scratch', emptyDir: { sizeLimit: '1664Mi' } }, { name: 'dependencies', emptyDir: { sizeLimit: '1280Mi' } }]);
    expect(pod.metadata.labels['sentropic.dev/artifact-binding']).toBeDefined();
    expect(podName({ ...key, storageScopeId: 'other' })).not.toBe(podName(key));
  });
  it('should bound each emptyDir by its role cap on disk and fit three builder pods in the ephemeral quota', async () => {
    const f = fixture(); const runtime = await f.controller.start(key); const pod = builderPod(key, runtime, 'trusted', placement);
    const { requests, limits } = pod.spec.containers[0].resources;
    const mebibytes = (value: string) => Number(/^(\d+)(Mi|Gi)$/.exec(value)![1]) * (value.endsWith('Gi') ? 1024 : 1);
    // On disk (never medium: Memory): every sizeLimit holds within its role cap; the container ephemeral limit bounds the total.
    const caps: Record<string, number> = { source: 384, scratch: 1664, dependencies: 1280 };
    for (const volume of pod.spec.volumes) {
      expect(mebibytes(volume.emptyDir.sizeLimit)).toBeLessThanOrEqual(caps[volume.name]);
      expect(volume.emptyDir).not.toHaveProperty('medium');
    }
    expect(mebibytes(limits['ephemeral-storage'])).toBe(3400);
    expect(3 * 3400).toBeLessThanOrEqual(10 * 1024);
    expect(pod.spec.volumes.reduce((sum: number, volume: { emptyDir: { sizeLimit: string } }) => sum + mebibytes(volume.emptyDir.sizeLimit), 0)).toBeLessThanOrEqual(3400 - 64);
    // k8s measured the d2-4 node: 1458m CPU free after system pods; only memory limits overcommit.
    expect(4 * Number(requests.cpu.replace(/m$/, ''))).toBeLessThanOrEqual(1458);
    expect(mebibytes(limits.memory)).toBeGreaterThan(mebibytes(requests.memory));
    // Tenant LimitRange (cpu <= 1 per container) and ResourceQuota (requests.cpu 1, requests.memory 3Gi, limits.memory 6Gi,
    // limits.ephemeral-storage 10Gi) admit MAX_BUILDER_PODS = 2 pods: the memory request is the measured build peak, so the
    // scheduler never overcommits a builder node into a kubelet eviction (k8s 09/11).
    expect(Number(limits.cpu)).toBeLessThanOrEqual(1);
    expect(4 * Number(requests.cpu.replace(/m$/, ''))).toBeLessThanOrEqual(1000);
    expect(4 * Number(limits.cpu)).toBeLessThanOrEqual(4);
    expect(4 * mebibytes(limits.memory)).toBeLessThanOrEqual(6 * 1024);
    expect(MAX_BUILDER_PODS * mebibytes(limits['ephemeral-storage'])).toBeLessThanOrEqual(10 * 1024);
    expect(MAX_BUILDER_PODS).toBe(2);
    expect(mebibytes(requests.memory)).toBeGreaterThanOrEqual(1280);
    expect(MAX_BUILDER_PODS * mebibytes(requests.memory)).toBeLessThanOrEqual(3 * 1024);
    expect(PRODUCT_HEAVY.maxPods).toBe(MAX_BUILDER_PODS);
  });
  it('should hold a ~1 GiB unpacked tree with margin by default and stay quota-safe under env sizing', async () => {
    // A ~1 GiB unpacked tree (preprod 2026-11-09: ~854 MiB unpacked, 745 paths): dependencies +25% over 1024,
    // scratch +17% over the ~1530 peak (tarballs + working copy + npm tmp), source +265% over the ~105 measured.
    const defaults = defaultWorkerSizing();
    expect(defaults).toEqual({ sourceMiB: 384, scratchMiB: 1664, dependenciesMiB: 1280 });
    expect(defaults.dependenciesMiB).toBeGreaterThanOrEqual(1024 * 1.2);
    expect(readWorkerSizing({})).toEqual(defaults);
    expect(readWorkerSizing({ ARTIFACT_VOLUME_SOURCE_MB: '384', ARTIFACT_VOLUME_SCRATCH_MB: '1600',
      ARTIFACT_VOLUME_DEPENDENCIES_MB: '1344' })).toEqual({ sourceMiB: 384, scratchMiB: 1600, dependenciesMiB: 1344 });
    for (const env of [{ ARTIFACT_VOLUME_SOURCE_MB: 'nope' }, { ARTIFACT_VOLUME_SOURCE_MB: '-5' },
      { ARTIFACT_VOLUME_SCRATCH_MB: '0' }, { ARTIFACT_VOLUME_DEPENDENCIES_MB: '' },
      { ARTIFACT_VOLUME_SOURCE_MB: '100000' }, { ARTIFACT_VOLUME_DEPENDENCIES_MB: '5000' },
      { ARTIFACT_VOLUME_SCRATCH_MB: '2048', ARTIFACT_VOLUME_DEPENDENCIES_MB: '2048' }]) {
      expect(readWorkerSizing(env)).toEqual(defaults);
    }
    // Custom sizing reaches the manifest while the quota-bound container limits never move.
    const f = fixture(); const runtime = await f.controller.start(key);
    const pod = builderPod(key, runtime, 'trusted', placement,
      { sourceMiB: 256, scratchMiB: 2048, dependenciesMiB: 1024 });
    expect(pod.spec.volumes).toEqual([{ name: 'source', emptyDir: { sizeLimit: '256Mi' } },
      { name: 'scratch', emptyDir: { sizeLimit: '2048Mi' } },
      { name: 'dependencies', emptyDir: { sizeLimit: '1024Mi' } }]);
    expect(pod.spec.containers[0].resources.limits).toEqual({ cpu: '1', memory: '1536Mi', 'ephemeral-storage': '3400Mi' });
  });
  it('should adopt the matching pod after a creation response is lost', async () => {
    const f = fixture(); const create = vi.mocked(f.core.create).getMockImplementation()!;
    vi.spyOn(f.core, 'create').mockImplementation(async (resource, value) => { const result = await create(resource, value);
      if (resource === 'pods') throw new Error('response lost'); return result; });
    const runtime = await f.controller.start(key);
    expect(runtime.phase).toBe('LIVE'); expect(f.core.create).toHaveBeenCalledTimes(2); expect(f.objects.size).toBe(2);
  });
  it('should never adopt or delete another generation worker', async () => {
    const f = fixture(); const runtime = await f.controller.start(key);
    const pod = f.objects.get('pods' + runtime.podName)!;
    pod.metadata.labels['sentropic.dev/artifact-generation'] = '999';
    await expect(f.ports.pods.ensure(key, runtime)).rejects.toMatchObject({ reason: 'stale_fence' });
    await expect(f.ports.pods.remove(key, runtime)).rejects.toMatchObject({ reason: 'stale_fence' });
    expect(f.core.delete).not.toHaveBeenCalled(); expect(f.core.create).toHaveBeenCalledTimes(2);
  });
  it('should recover a provision intent whose pod UID was not recorded', async () => {
    const f = fixture(); await f.controller.start(key);
    await f.ports.store.transaction(key, async unit => { unit.state!.runtime.podUid = null; unit.state!.runtime.phase = 'REVIVING'; });
    await f.controller.recover(key); expect(f.objects.size).toBe(0); expect(f.core.create).toHaveBeenCalledTimes(2);
  });
  it('should delete ownerless pods and services with Background propagation and uid preconditions', async () => {
    expect(deleteOptions('uid-1')).toEqual({ apiVersion: 'v1', kind: 'DeleteOptions',
      propagationPolicy: 'Background', preconditions: { uid: 'uid-1' } });
    expect(deleteOptions(undefined)).toEqual({ apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background' });
  });
  it('should teardown a terminal pod without quiesce and release the pod, service and heavy slot', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    const pod = f.objects.get('pods' + live.podName)!;
    pod.status = { phase: 'Succeeded' }; pod.metadata.deletionTimestamp = '2026-11-08T21:53:41Z';
    f.ports.worker.quiesce = vi.fn(async () => { throw new LiveError('builder_unavailable', 'supervisor_relay_502'); });
    await expect(f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 }))
      .resolves.toEqual({ liveSessionId: live.sessionId, state: 'stopped' });
    expect(f.ports.worker.quiesce).not.toHaveBeenCalled();
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
  it('should teardown a terminating pod without quiesce', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    f.objects.get('pods' + live.podName)!.metadata.deletionTimestamp = '2026-11-08T21:53:41Z';
    f.ports.worker.quiesce = vi.fn(async () => { throw new LiveError('builder_unavailable', 'supervisor_relay_502'); });
    await f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 });
    expect(f.ports.worker.quiesce).not.toHaveBeenCalled();
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
  it('should replace a leftover service with a stale selector on the next ensure', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    const service = f.objects.get('services' + live.podName)!;
    const staleUid = service.metadata.uid;
    // The pod is gone (NotFound, like preprod) while its service still carries the previous lease's selector.
    f.objects.delete('pods' + live.podName);
    service.metadata.labels['sentropic.dev/artifact-generation'] = '999';
    (service.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-generation'] = '999';
    const revived = { ...live, podUid: null, leaseEpoch: live.leaseEpoch + 1 };
    await expect(f.ports.pods.ensure(key, revived)).resolves.toMatchObject({ uid: expect.any(String) });
    expect(f.core.delete).toHaveBeenCalledWith('services', live.podName, staleUid);
    const replaced = f.objects.get('services' + live.podName)!;
    expect(replaced.metadata.uid).not.toBe(staleUid);
    expect((replaced.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-generation']).toBe('1');
    expect((replaced.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-lease'])
      .toBe(String(live.leaseEpoch + 1));
    expect(f.objects.size).toBe(2);
  });
  it('should refuse a service of an equal or newer lease with stale_fence and never delete it', async () => {
    // Same lease, another generation: the recorded pod uid is set, so any selector divergence fences.
    {
      const f = fixture(); const live = await f.controller.start(key);
      const service = f.objects.get('services' + live.podName)!;
      service.metadata.labels['sentropic.dev/artifact-generation'] = '999';
      (service.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-generation'] = '999';
      await expect(f.ports.pods.ensure(key, live)).rejects.toMatchObject({ reason: 'stale_fence' });
      expect(f.core.delete).not.toHaveBeenCalled();
      expect(f.objects.get('services' + live.podName)!.metadata.uid).toBe(service.metadata.uid);
    }
    // Newer lease: a stale ensure of the older lease must not delete the revived lease's service.
    {
      const f = fixture(); const live = await f.controller.start(key);
      const service = f.objects.get('services' + live.podName)!;
      const currentUid = service.metadata.uid;
      service.metadata.labels['sentropic.dev/artifact-lease'] = String(live.leaseEpoch + 1);
      (service.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-lease'] = String(live.leaseEpoch + 1);
      await expect(f.ports.pods.ensure(key, { ...live, podUid: null })).rejects.toMatchObject({ reason: 'stale_fence' });
      expect(f.core.delete).not.toHaveBeenCalled();
      expect(f.objects.get('services' + live.podName)!.metadata.uid).toBe(currentUid);
    }
    // Same lease, another session: selector divergence without an older lease fences too.
    {
      const f = fixture(); const live = await f.controller.start(key);
      const service = f.objects.get('services' + live.podName)!;
      const currentUid = service.metadata.uid;
      service.metadata.labels['sentropic.dev/artifact-session'] = 'other-session';
      (service.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-session'] = 'other-session';
      await expect(f.ports.pods.ensure(key, live)).rejects.toMatchObject({ reason: 'stale_fence' });
      expect(f.core.delete).not.toHaveBeenCalled();
      expect(f.objects.get('services' + live.podName)!.metadata.uid).toBe(currentUid);
    }
  });
  it('should skip quiesce when the pod uid was never recorded', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    await f.ports.store.transaction(key, async unit => { unit.state!.runtime.podUid = null; unit.state!.runtime.phase = 'REVIVING'; });
    // Production admit() refuses any supervisor command without a pod uid; teardown must not need one.
    f.ports.worker.quiesce = vi.fn(async () => { throw new LiveError('builder_unavailable', 'supervisor_channel_error'); });
    await f.controller.recover(key);
    expect(f.ports.worker.quiesce).not.toHaveBeenCalled();
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
  it('should delete the pod when quiesce fails on an active pod', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    f.ports.worker.quiesce = vi.fn(async () => { throw new LiveError('builder_unavailable', 'supervisor_relay_502'); });
    await expect(f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 }))
      .resolves.toEqual({ liveSessionId: live.sessionId, state: 'stopped' });
    expect(f.ports.worker.quiesce).toHaveBeenCalledTimes(1);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
  it('should bound a hanging quiesce instead of blocking the stop', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    vi.useFakeTimers();
    try {
      f.ports.worker.quiesce = vi.fn(() => new Promise<never>(() => {}));
      const stopped = f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 });
      const assertion = expect(stopped).resolves.toEqual({ liveSessionId: live.sessionId, state: 'stopped' });
      await vi.advanceTimersByTimeAsync(10_000); await assertion;
    } finally { vi.useRealTimers(); }
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
  it('should skip the pod delete without a known uid when the pod is already gone', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    f.objects.delete('pods' + live.podName);
    await f.ports.pods.remove(key, { ...live, podUid: null });
    expect(f.core.delete).toHaveBeenCalledTimes(1);
    expect(f.core.delete).toHaveBeenCalledWith('services', live.podName, expect.any(String));
    expect(f.objects.size).toBe(0);
  });
  it('should probe the pod fence before deciding to quiesce', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    expect(await f.ports.pods.probe(key, live)).toBe('active');
    f.objects.delete('pods' + live.podName);
    expect(await f.ports.pods.probe(key, live)).toBe('absent');
    await f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 });
    const relive = await f.controller.start(key);
    f.objects.get('pods' + relive.podName)!.metadata.labels['sentropic.dev/artifact-generation'] = '999';
    await expect(f.ports.pods.probe(key, relive)).rejects.toMatchObject({ reason: 'stale_fence' });
  });
  it('should build a selected reachable historical commit without starting live or staging a draft', async () => {
    const f = fixture(); await f.controller.buildOnly(key, 'job-A');
    expect(f.events).toContain('prepare:A'); expect(f.events).not.toContain('restore'); expect(f.events).not.toContain('ready');
    expect(f.ports.worker.live).not.toHaveBeenCalled(); expect(f.published).toEqual(['A']);
    expect((await f.state())?.progress).toMatchObject({ latestVerifiedHeadSha: 'B', publicationBaselineHeadSha: 'B' });
    expect(f.draft().dirty).toBe(true); expect(f.objects.size).toBe(0);
    await f.controller.start(key); f.advance(900_001); await f.controller.reap(key); expect(f.published).toEqual(['A']);
  });
});
