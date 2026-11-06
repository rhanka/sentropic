import type { LivePorts } from './ports';
import { assertFence, automaticEligible, conflict, LiveError, publicationBaseline, type LiveKey, type LiveRuntime } from './records';
import { checkpoint, currentBinding, failed, observeHead, teardown, transition } from './transitions';

export async function idleBuild(ports: LivePorts, key: LiveKey) {
  const binding = await currentBinding(ports, key);
  let runtime = await ports.store.transaction(key, async unit => {
    if (!unit.state || unit.state.runtime.phase !== 'LIVE' || ports.now() - unit.state.runtime.lastAccessAt <= 600_000) return;
    if (unit.state.runtime.generation !== binding.generation) conflict('stale_fence');
    unit.state.runtime.phase = 'QUIESCING'; unit.state.runtime.routeEpoch++;
    return structuredClone(unit.state.runtime);
  });
  if (!runtime) return;
  try {
    if (ports.now() >= runtime.maximumLifetimeAt) return await teardown(ports, key, runtime);
    await ports.routes.revoke(key, runtime);
    await ports.worker.quiesce(runtime);
    const draft = await checkpoint(ports, key, runtime);
    const head = await observeHead(ports, key, runtime);
    if (draft.dirty && draft.baseHeadSha !== head) throw new LiveError('git_live_draft_conflict');
    const source = await ports.forge.snapshot(key, head);
    if (source.headSha !== head) throw new LiveError('git_head_moved');
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.pendingWake || state.runtime.phase !== 'QUIESCING') conflict('stale_fence');
      state.runtime.phase = 'BUILDING';
      state.runtime.attempt = { id: ports.id(), kind: 'idle', headSha: head, treeSha: source.treeSha,
        startedAt: ports.now(), leaseEpoch: state.runtime.leaseEpoch, routeEpoch: state.runtime.routeEpoch,
        expectedReleaseId: binding.releaseId, progressSeq: state.progress.progressSeq,
        baselineSeq: state.progress.publicationBaselineSeq, initial: state.progress.initialUnpublishedBranchEligible };
    });
    const attempt = runtime.attempt!;
    const cache = await ports.cache.acquire(source);
    await ports.worker.clean(runtime);
    await ports.worker.prepare(runtime, source, cache);
    // Deliberately never call restore: the acknowledged draft remains in the trusted store.
    const candidate = await ports.worker.build(runtime, attempt);
    runtime = await transition(ports, key, runtime, state => {
      if (state.runtime.pendingWake || state.runtime.phase !== 'BUILDING' || state.runtime.attempt?.id !== attempt.id) conflict('stale_fence');
      state.runtime.phase = 'VERIFYING'; state.runtime.attempt.candidateDigest = candidate.candidateDigest;
    });
    await ports.worker.verify(runtime, runtime.attempt!);
    const finalHead = await observeHead(ports, key, runtime);
    if (finalHead !== head) throw new LiveError('git_head_moved');
    runtime = await ports.store.transaction(key, async unit => {
      assertFence(unit.state, runtime!);
      const current = await currentBinding(ports, key, runtime!.generation);
      const state = unit.state;
      if (state.runtime.pendingWake || state.runtime.phase !== 'VERIFYING' || state.runtime.attempt?.id !== attempt.id
        || ports.now() >= state.runtime.maximumLifetimeAt) conflict('stale_fence');
      if (current.releaseId !== attempt.expectedReleaseId) throw new LiveError('pointer_conflict');
      if (current.autoPublish && current.automaticAuthorized && automaticEligible(state.progress, attempt, current.releaseCommit)) {
        state.runtime.phase = 'PUBLISHING';
        // The row lock serializes finalization vs wake. Publication and baseline consumption roll back together.
        const published = await ports.publication.commit(unit, key, state.runtime.attempt);
        publicationBaseline(state.progress, published.releaseId);
      }
      state.runtime.phase = 'SAVING';
      return structuredClone(state.runtime);
    });
    return await teardown(ports, key, runtime);
  } catch (error) {
    if (error instanceof LiveError && error.reason === 'stale_fence') return;
    await failed(ports, key, runtime, error);
    throw error;
  }
}
