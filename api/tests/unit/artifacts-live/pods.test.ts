import { describe, expect, it, vi } from 'vitest';
import { fixture, key, placement } from './fixture';
import { builderPod, podName } from '../../../src/services/artifacts/live/pods';
import { deleteOptions } from '../../../src/services/artifacts/live/kubernetes';
import { LiveError } from '../../../src/services/artifacts/live/records';
import { BUILDER_IMAGE } from '../../../src/services/artifacts/live/recipes';

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
    expect(res.requests).toEqual({ cpu: '250m', memory: '420Mi', 'ephemeral-storage': '0' });
    expect(res.limits).toEqual({ cpu: '1', memory: '1536Mi', 'ephemeral-storage': '2560Mi' });
    expect(pod.spec.containers[0].env).toContainEqual({ name: 'NODE_OPTIONS', value: '--max-old-space-size=384' });
    expect(pod.spec.containers[0].env).toContainEqual({ name: 'ARTIFACT_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } });
    expect(pod.spec.containers[0].env.filter(entry => 'valueFrom' in entry)).toHaveLength(1);
    expect(pod.spec.volumes).toEqual([{ name: 'source', emptyDir: { sizeLimit: '384Mi' } },
      { name: 'scratch', emptyDir: { sizeLimit: '1536Mi' } }, { name: 'dependencies', emptyDir: { sizeLimit: '1152Mi' } }]);
    expect(pod.metadata.labels['sentropic.dev/artifact-binding']).toBeDefined();
    expect(podName({ ...key, storageScopeId: 'other' })).not.toBe(podName(key));
  });
  it('should bound each emptyDir by its role cap on disk and fit four builder pods on one d2-4 node', async () => {
    const f = fixture(); const runtime = await f.controller.start(key); const pod = builderPod(key, runtime, 'trusted', placement);
    const { requests, limits } = pod.spec.containers[0].resources;
    const mebibytes = (value: string) => Number(/^(\d+)(Mi|Gi)$/.exec(value)![1]) * (value.endsWith('Gi') ? 1024 : 1);
    // On disk (never medium: Memory): every sizeLimit holds within its role cap; the container ephemeral limit bounds the total.
    const caps: Record<string, number> = { source: 384, scratch: 1536, dependencies: 1152 };
    for (const volume of pod.spec.volumes) {
      expect(mebibytes(volume.emptyDir.sizeLimit)).toBeLessThanOrEqual(caps[volume.name]);
      expect(volume.emptyDir).not.toHaveProperty('medium');
    }
    expect(mebibytes(limits['ephemeral-storage'])).toBe(2560);
    // k8s measured the d2-4 node: 1458m CPU free after system pods; only memory limits overcommit.
    expect(4 * Number(requests.cpu.replace(/m$/, ''))).toBeLessThanOrEqual(1458);
    expect(mebibytes(limits.memory)).toBeGreaterThan(mebibytes(requests.memory));
    // Tenant LimitRange (cpu <= 1 per container) and ResourceQuota (requests.cpu 1, limits.memory 6Gi,
    // limits.ephemeral-storage 10Gi, pods 5) admit four pods; four limits fit the quota (4 CPU, 6Gi, 10Gi)
    // and four memory requests fit the 1706 MiB node share.
    expect(Number(limits.cpu)).toBeLessThanOrEqual(1);
    expect(4 * Number(requests.cpu.replace(/m$/, ''))).toBeLessThanOrEqual(1000);
    expect(4 * Number(limits.cpu)).toBeLessThanOrEqual(4);
    expect(4 * mebibytes(limits.memory)).toBeLessThanOrEqual(6 * 1024);
    expect(4 * mebibytes(limits['ephemeral-storage'])).toBeLessThanOrEqual(10 * 1024);
    expect(4 * mebibytes(requests.memory)).toBeLessThanOrEqual(1706);
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
    // The pod is gone (NotFound, like preprod) while its service still carries the previous session's selector.
    f.objects.delete('pods' + live.podName);
    service.metadata.labels['sentropic.dev/artifact-generation'] = '999';
    (service.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-generation'] = '999';
    await expect(f.ports.pods.ensure(key, { ...live, podUid: null })).resolves.toMatchObject({ uid: expect.any(String) });
    expect(f.core.delete).toHaveBeenCalledWith('services', live.podName, staleUid);
    const replaced = f.objects.get('services' + live.podName)!;
    expect(replaced.metadata.uid).not.toBe(staleUid);
    expect((replaced.spec as { selector: Record<string, string> }).selector['sentropic.dev/artifact-generation']).toBe('1');
    expect(f.objects.size).toBe(2);
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
    f.ports.worker.quiesce = vi.fn(() => new Promise<never>(() => {}));
    await expect(f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 }))
      .resolves.toEqual({ liveSessionId: live.sessionId, state: 'stopped' });
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  }, 20_000);
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
