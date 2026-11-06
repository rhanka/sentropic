import type { LivePorts } from './ports';
import { assertFence, conflict, LiveError, publicationBaseline, type LiveKey } from './records';
import { podName } from './pods';
import { checkpoint, currentBinding, failed, observeHead, teardown, transition } from './transitions';
import { withinPhase } from './deadline';

/** Explicit historical publication uses one clean pod; dormant drafts never enter this worker. */
export async function buildOnly(ports: LivePorts, key: LiveKey, jobId: string) {
  const binding = await currentBinding(ports, key);
  const job = await ports.publication.job(key, jobId);
  if (!await ports.forge.reachable(key, job.headSha)) throw new LiveError('git_head_moved');
  const draft = await ports.drafts.current(key, binding.generation);
  if (draft.generation !== binding.generation) conflict('stale_fence');
  let runtime = await ports.store.transaction(key, async unit => {
    if (unit.state && unit.state.runtime.phase !== 'DORMANT') conflict('pending_publication');
    const previous = unit.state;
    const runtime = { generation: binding.generation, ownerId: binding.ownerId, sessionId: ports.id(),
      phase: 'BUILD_PROVISIONING' as const, leaseEpoch: (previous?.runtime.leaseEpoch ?? 0) + 1,
      rowVersion: previous?.runtime.rowVersion ?? 0, podUid: null, podName: podName(key),
      sourceRevision: draft.revision, appliedRevision: null, baseHeadSha: draft.baseHeadSha, liveTreeSha: draft.treeSha,
      lastAccessAt: ports.now(), maximumLifetimeAt: ports.now() + 3_600_000,
      routeEpoch: (previous?.runtime.routeEpoch ?? 0) + 1, pendingWake: false, attempt: null };
    unit.save({ runtime, progress: previous?.progress.generation === binding.generation ? previous.progress : {
      generation: binding.generation, latestVerifiedHeadSha: binding.headSha, progressSeq: 0,
      publicationBaselineHeadSha: binding.headSha, publicationBaselineSeq: 0, lastProgressEventId: null,
      lastSuccessfulReleaseId: null, initialUnpublishedBranchEligible: binding.initialUnpublishedBranchEligible,
    } });
    return structuredClone(unit.state!.runtime);
  });
  try {
    await checkpoint(ports, key, runtime);
    const pod = await ports.pods.ensure(key, runtime);
    runtime = await transition(ports, key, runtime, state => { state.runtime.podUid = pod.uid; });
    const source = await ports.forge.snapshot(key, job.headSha);
    if (source.headSha !== job.headSha) throw new LiveError('git_head_moved');
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.phase !== 'BUILD_PROVISIONING') conflict('stale_fence');
      state.runtime.phase = 'BUILDING';
      state.runtime.attempt = { id: jobId, kind: 'explicit', headSha: job.headSha, treeSha: source.treeSha,
        startedAt: ports.now(), leaseEpoch: runtime.leaseEpoch, routeEpoch: runtime.routeEpoch,
        expectedReleaseId: job.expectedReleaseId, progressSeq: state.progress.progressSeq,
        baselineSeq: state.progress.publicationBaselineSeq, initial: false };
    });
    await ports.worker.clean(runtime);
    const cache = await withinPhase(ports.cache.acquire(source, runtime));
    await ports.worker.prepare(runtime, source, cache);
    const candidate = await withinPhase(ports.worker.build(runtime, runtime.attempt!));
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.phase !== 'BUILDING' || state.runtime.pendingWake) conflict('stale_fence');
      state.runtime.phase = 'VERIFYING'; state.runtime.attempt!.candidateDigest = candidate.candidateDigest;
    });
    await ports.worker.verify(runtime, runtime.attempt!);
    await observeHead(ports, key, runtime);
    runtime = await ports.store.transaction(key, async unit => {
      assertFence(unit.state, runtime);
      const current = await currentBinding(ports, key, runtime.generation);
      if (unit.state.runtime.phase !== 'VERIFYING' || unit.state.runtime.pendingWake
        || !await ports.forge.reachable(key, job.headSha) || ports.now() >= runtime.maximumLifetimeAt) conflict('stale_fence');
      if (current.releaseId !== job.expectedReleaseId) throw new LiveError('pointer_conflict');
      const published = await ports.publication.commit(unit, key, unit.state.runtime.attempt!);
      publicationBaseline(unit.state.progress, published.releaseId);
      unit.state.runtime.phase = 'SAVING'; return structuredClone(unit.state.runtime);
    });
    return await teardown(ports, key, runtime);
  } catch (error) {
    if (error instanceof LiveError && error.reason === 'stale_fence') return;
    await failed(ports, key, runtime, error); throw error;
  }
}
