import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { bindingLabel, classifyPodLoss, enrichPodLoss, isPodCause, isTransportLoss, podName } from '../../../src/services/artifacts/live/pods';
import { LiveError, type LiveRuntime } from '../../../src/services/artifacts/live/records';

/** Mirrors the session label `pods.ts` derives (a digest, never the raw session id). */
const sessionLabel = (sessionId: string) =>
  createHash('sha256').update(JSON.stringify(sessionId)).digest('hex').slice(0, 40);
const podLabels = (sessionId: string, leaseEpoch: number) => ({
  'sentropic.dev/artifact-binding': bindingLabel(key),
  'sentropic.dev/artifact-session': sessionLabel(sessionId),
  'sentropic.dev/artifact-generation': '1',
  'sentropic.dev/artifact-lease': String(leaseEpoch),
});

const evicted = () => ({ phase: 'Failed', reason: 'Evicted', message: 'The node was low on resource: memory.' });
const oomkilled = () => ({ phase: 'Failed', containerStatuses: [{ lastState: { terminated: { reason: 'OOMKilled' } } }] });
const relay502 = () => new LiveError('builder_unavailable', 'supervisor_relay_502');
const oldPod = '1969-12-31T23:00:00.000Z';

function buildRuntime(sessionId: string): LiveRuntime {
  return { generation: 1, ownerId: 'owner', sessionId, phase: 'BUILD_PROVISIONING', leaseEpoch: 1, rowVersion: 0,
    podUid: null, podName: podName(key), sourceRevision: 'r1', appliedRevision: null, baseHeadSha: 'B',
    liveTreeSha: 'tree-B-dirty', lastAccessAt: 0, routeEpoch: 1, invitationEpoch: 0, invitationExpiresAt: null,
    pendingWake: false, attempt: null };
}

describe('builder pod resilience (09/11 pod loss)', () => {
  it('(a) deletes an adopted pod whose supervisor does not answer and recreates it, then the job succeeds', async () => {
    const f = fixture();
    f.objects.set('pods' + podName(key), { metadata: { name: podName(key), uid: 'uid-0',
      labels: podLabels('id-1', 1), creationTimestamp: oldPod }, spec: {}, status: { phase: 'Running' } });
    f.ports.worker.renew = vi.fn(async () => { throw relay502(); });
    await f.controller.buildOnly(key, 'job-A');
    expect(f.ports.worker.renew).toHaveBeenCalledTimes(1);
    expect(f.core.delete).toHaveBeenCalledWith('pods', podName(key), 'uid-0');
    expect(f.published).toEqual(['A']);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
  it('never adopts a dead pod of the same lease: it is deleted and recreated fenced', async () => {
    const f = fixture(); const runtime = buildRuntime('sess-adopt');
    const seed = (status: { phase: string; reason?: string }) => f.objects.set('pods' + podName(key),
      { metadata: { name: podName(key), uid: 'uid-dead', labels: podLabels('sess-adopt', 1),
        creationTimestamp: oldPod }, spec: {}, status });
    seed({ phase: 'Failed', reason: 'Evicted' });
    const ensured = await f.ports.pods.ensure(key, runtime);
    expect(ensured.adopted).toBe(false);
    expect(ensured.uid).not.toBe('uid-dead');
    expect(f.core.delete).toHaveBeenCalledWith('pods', podName(key), 'uid-dead');
    expect(f.objects.get('pods' + podName(key))!.metadata.uid).toBe(ensured.uid);
  });
  it('(b) retries an eviction mid-build once on a fresh pod and succeeds', async () => {
    const f = fixture(); let builds = 0;
    f.ports.worker.build = vi.fn(async () => {
      builds++;
      if (builds === 1) {
        f.objects.get('pods' + podName(key))!.status = evicted();
        throw relay502();
      }
      return { candidateDigest: 'candidate' };
    });
    await f.controller.buildOnly(key, 'job-A');
    expect(builds).toBe(2);
    expect(f.published).toEqual(['A']);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
    const jobs = vi.mocked(f.ports.publication.job).mock.calls;
    expect(jobs).toHaveLength(2);
    expect(jobs[0][1]).toBe('job-A'); expect(jobs[1][1]).toBe('job-A');
    expect(jobs[0][2]).toMatchObject({ attempt: 1 }); expect(jobs[1][2]).toMatchObject({ attempt: 2 });
    expect(jobs[0][2].runId).not.toBe(jobs[1][2].runId);
  });
  it('(c) never retries a deterministic failure and tears the pod down', async () => {
    const f = fixture();
    f.ports.worker.build = vi.fn(async () => { throw new LiveError('builder_unavailable', 'build_failed:exit_1'); });
    await expect(f.controller.buildOnly(key, 'job-A')).rejects.toMatchObject({ reason: 'build_failed:exit_1' });
    expect(f.ports.worker.build).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.ports.publication.job).mock.calls).toHaveLength(1);
    expect(f.published).toEqual([]);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null,
      stateDetail: 'builder_unavailable:build_failed:exit_1' });
    expect(f.objects.size).toBe(0);
  });
  it('(d) carries pod_evicted through the retry and reports it when the fresh pod is evicted too', async () => {
    const f = fixture();
    f.ports.worker.build = vi.fn(async () => {
      f.objects.get('pods' + podName(key))!.status = evicted();
      throw relay502();
    });
    await expect(f.controller.buildOnly(key, 'job-A')).rejects.toMatchObject({ reason: 'pod_evicted' });
    expect(f.ports.worker.build).toHaveBeenCalledTimes(2);
    expect(f.published).toEqual([]);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null,
      stateDetail: 'builder_unavailable:pod_evicted' });
    expect(f.objects.size).toBe(0);
  });
  it('(d) reports pod_oomkilled without retrying', async () => {
    const f = fixture();
    f.ports.worker.build = vi.fn(async () => {
      f.objects.get('pods' + podName(key))!.status = oomkilled();
      throw relay502();
    });
    await expect(f.controller.buildOnly(key, 'job-A')).rejects.toMatchObject({ reason: 'pod_oomkilled' });
    expect(f.ports.worker.build).toHaveBeenCalledTimes(1);
    expect(f.published).toEqual([]);
    expect((await f.state())?.runtime).toMatchObject({ stateDetail: 'builder_unavailable:pod_oomkilled' });
  });
  it('classifies pod losses from the Kubernetes status with bounded scrubbed detail', () => {
    expect(classifyPodLoss(undefined)).toMatchObject({ reason: 'pod_gone' });
    expect(classifyPodLoss({ oomkilled: false, phase: 'Running' })).toMatchObject({ reason: 'supervisor_unresponsive' });
    expect(classifyPodLoss({ oomkilled: false, phase: 'Failed' })).toMatchObject({ reason: 'pod_unavailable' });
    expect(classifyPodLoss({ oomkilled: false, phase: 'Succeeded' })).toMatchObject({ reason: 'pod_unavailable' });
    expect(classifyPodLoss({ oomkilled: false, phase: 'Running', deletionTimestamp: 't' }))
      .toMatchObject({ reason: 'pod_unavailable' });
    expect(classifyPodLoss({ oomkilled: false, phase: 'Failed', reason: 'Evicted', message: 'node pressure' }))
      .toMatchObject({ reason: 'pod_evicted', detail: 'Evicted: node pressure' });
    expect(classifyPodLoss({ oomkilled: true, phase: 'Failed' })).toMatchObject({ reason: 'pod_oomkilled' });
    expect(classifyPodLoss({ oomkilled: true, phase: 'Running' })).toMatchObject({ reason: 'pod_oomkilled' });
    // ContainerStatuses carry state and lastState terminations; the detail never leaks token-like material.
    const loss = classifyPodLoss({ oomkilled: false, phase: 'Failed', reason: 'Evicted',
      message: 'memory, token=secret-value' });
    expect(loss).toMatchObject({ reason: 'pod_evicted' });
    expect(loss.detail).toContain('[redacted]'); expect(loss.detail).not.toContain('secret-value');
    expect(loss.detail.length).toBeLessThanOrEqual(512);
  });
  it('retries transport losses only, and keeps the relay reason when the apiserver is unreadable', async () => {
    for (const reason of ['pod_evicted', 'pod_gone', 'pod_unavailable', 'supervisor_unresponsive',
      'supervisor_relay_502', 'supervisor_relay_unreachable', 'supervisor_channel_aborted',
      'k8s_unreachable', 'k8s_timeout']) {
      expect(isTransportLoss(new LiveError('builder_unavailable', reason))).toBe(true);
    }
    for (const reason of ['pod_oomkilled', 'install_failed:oom', 'build_failed:exit_1', 'output_changed',
      'verify_invalid', 'publication_refused', 'git_head_moved', 'phase_timeout:build', 'queued', undefined]) {
      expect(isTransportLoss(new LiveError('builder_unavailable', reason))).toBe(false);
    }
    expect(isTransportLoss(new LiveError('git_live_conflict', 'stale_fence'))).toBe(false);
    expect(isPodCause(new LiveError('builder_unavailable', 'pod_evicted'))).toBe(true);
    expect(isPodCause(new LiveError('builder_unavailable', 'supervisor_relay_502'))).toBe(false);
    const unreadable = { describe: async () => { throw new LiveError('builder_unavailable', 'k8s_unreachable'); } };
    await expect(enrichPodLoss(unreadable, key, buildRuntime('s'), relay502())).resolves.toMatchObject({ reason: 'supervisor_relay_502' });
    const deterministic = { describe: async () => ({ oomkilled: false, phase: 'Running' as const }) };
    const install = new LiveError('builder_unavailable', 'install_failed:oom');
    await expect(enrichPodLoss(deterministic, key, buildRuntime('s'), install)).resolves.toBe(install);
  });
  it('(e) converges a RECOVERING runtime with a gone pod to DORMANT on tick', async () => {
    const f = fixture(); await f.controller.start(key);
    f.core.waitDeleted = vi.fn(async () => { throw new Error('unconfirmed'); });
    f.objects.delete('pods' + podName(key));
    await f.controller.reconcile(key);
    expect((await f.state())?.runtime.phase).toBe('RECOVERING');
    f.core.waitDeleted = vi.fn(async (kind, name) => { if (f.objects.has(kind + name)) throw new Error('still running'); });
    await f.controller.reconcile(key);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
  it('(e) converges a RECOVERING runtime with an evicted pod to DORMANT on tick', async () => {
    const f = fixture(); await f.controller.start(key);
    f.core.waitDeleted = vi.fn(async () => { throw new Error('unconfirmed'); });
    f.objects.get('pods' + podName(key))!.status = evicted();
    await f.controller.reconcile(key);
    expect((await f.state())?.runtime.phase).toBe('RECOVERING');
    f.core.waitDeleted = vi.fn(async (kind, name) => { if (f.objects.has(kind + name)) throw new Error('still running'); });
    await f.controller.reconcile(key);
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null });
    expect(f.objects.size).toBe(0);
  });
});
