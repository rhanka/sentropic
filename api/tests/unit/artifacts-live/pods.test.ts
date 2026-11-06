import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { builderPod, podName } from '../../../src/services/artifacts/live/pods';
import { BUILDER_IMAGE } from '../../../src/services/artifacts/live/recipes';

describe('builder pod admission and recovery', () => {
  it('should emit the exact VAP/PSA manifest without credentials or persistent volumes', async () => {
    const f = fixture(); const runtime = await f.controller.start(key); const pod = builderPod(key, runtime, 'trusted');
    expect(pod.spec).toMatchObject({ serviceAccountName: 'artifact-builder', automountServiceAccountToken: false,
      activeDeadlineSeconds: 3600, restartPolicy: 'Never', securityContext: { runAsNonRoot: true } });
    expect(pod.spec.containers).toHaveLength(1); expect(pod.spec.containers[0].image).toBe(BUILDER_IMAGE);
    expect(pod.spec.containers[0].securityContext).toMatchObject({ allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
    expect(pod.spec.volumes.every(volume => Object.keys(volume).sort().join(',') === 'emptyDir,name')).toBe(true);
    expect(pod.metadata.labels['sentropic.dev/artifact-binding']).toBeDefined();
    expect(podName({ ...key, storageScopeId: 'other' })).not.toBe(podName(key));
  });
  it('should adopt the matching pod after a creation response is lost', async () => {
    const f = fixture(); const create = f.core.create;
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
  it('should build a selected reachable historical commit without starting live or staging a draft', async () => {
    const f = fixture(); await f.controller.buildOnly(key, 'job-A');
    expect(f.events).toContain('prepare:A'); expect(f.events).not.toContain('restore'); expect(f.events).not.toContain('ready');
    expect(f.ports.worker.live).not.toHaveBeenCalled(); expect(f.published).toEqual(['A']);
    expect((await f.state())?.progress).toMatchObject({ latestVerifiedHeadSha: 'B', publicationBaselineHeadSha: 'B' });
    expect(f.draft().dirty).toBe(true); expect(f.objects.size).toBe(0);
    await f.controller.start(key); f.advance(600_001); await f.controller.idle(key); expect(f.published).toEqual(['A']);
  });
});
