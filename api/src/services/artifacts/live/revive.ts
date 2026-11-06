import type { LivePorts } from './ports';
import { conflict, type LiveKey, type LiveRuntime } from './records';
import { podName } from './pods';
import { currentBinding, failed } from './transitions';
import { prepareLive } from './prepare-live';
import { withinPhase } from './deadline';

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
  try { return await withinPhase(prepareLive(ports, key, runtime)); }
  catch (error) { await failed(ports, key, runtime, error); throw error; }
}
