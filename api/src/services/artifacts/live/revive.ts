import type { LivePorts } from './ports';
import { conflict, LiveError, type LiveKey, type LiveRuntime } from './records';
import { podName } from './pods';
import { checkpoint, currentBinding, failed, observeHead, transition } from './transitions';

export async function revive(ports: LivePorts, key: LiveKey) {
  const binding = await currentBinding(ports, key);
  const draft = await ports.drafts.current(key);
  if (draft.generation !== binding.generation) conflict('stale_fence');
  const runtime = await ports.store.transaction(key, async unit => {
    const previous = unit.state;
    if (previous && previous.runtime.phase !== 'DORMANT') conflict('transition_busy');
    const epoch = (previous?.runtime.leaseEpoch ?? 0) + 1;
    const now = ports.now();
    const runtime: LiveRuntime = { generation: binding.generation, ownerId: binding.ownerId,
      sessionId: ports.id(), phase: 'REVIVING', leaseEpoch: epoch, rowVersion: previous?.runtime.rowVersion ?? 0,
      podName: podName(key), podUid: null, sourceRevision: draft.revision, appliedRevision: null,
      baseHeadSha: draft.baseHeadSha, liveTreeSha: draft.treeSha, lastAccessAt: now, maximumLifetimeAt: now + 3_600_000,
      routeEpoch: (previous?.runtime.routeEpoch ?? 0) + 1, pendingWake: false, attempt: null };
    const progress = previous?.progress.generation === binding.generation ? previous.progress : {
      generation: binding.generation, latestVerifiedHeadSha: binding.headSha, progressSeq: 0,
      publicationBaselineHeadSha: binding.headSha, publicationBaselineSeq: 0, lastProgressEventId: null,
      lastSuccessfulReleaseId: null, initialUnpublishedBranchEligible: binding.initialUnpublishedBranchEligible,
    };
    unit.save({ runtime, progress });
    return structuredClone(runtime);
  });
  try {
    const head = await observeHead(ports, key, runtime);
    if (draft.dirty && draft.baseHeadSha !== head) throw new LiveError('git_live_draft_conflict');
    await checkpoint(ports, key, runtime);
    const pod = await ports.pods.ensure(key, runtime);
    runtime.podUid = pod.uid;
    await transition(ports, key, runtime, state => { state.runtime.podUid = pod.uid; });
    const source = await ports.forge.snapshot(key, head);
    if (source.headSha !== head) throw new LiveError('git_head_moved');
    const cache = await ports.cache.acquire(source);
    await ports.worker.clean(runtime);
    await ports.worker.prepare(runtime, source, cache);
    await ports.worker.restore(runtime, draft);
    const ready = await ports.worker.live(runtime);
    await currentBinding(ports, key, runtime.generation);
    const finalHead = await ports.forge.head(key);
    if (finalHead !== head) throw new LiveError('git_head_moved');
    const live = await transition(ports, key, runtime, state => {
      if (state.runtime.phase !== 'REVIVING' || ready.revision !== state.runtime.sourceRevision
        || ready.routeEpoch !== state.runtime.routeEpoch) conflict('stale_fence');
      state.runtime.phase = 'LIVE'; state.runtime.appliedRevision = ready.revision;
    });
    await ports.routes.ready(key, live);
    return live;
  } catch (error) { await failed(ports, key, runtime, error); throw error; }
}
