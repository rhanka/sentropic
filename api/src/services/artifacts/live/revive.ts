import type { LivePorts } from './ports';
import { conflict, LiveError, liveRevision, type LiveKey, type LiveRuntime } from './records';
import { podName } from './pods';
import { releaseIfDormant } from './admission';
import { currentBinding, failed } from './transitions';
import { prepareLive } from './prepare-live';

/** Cold revive, or the fenced replacement after a crash. A refused pod slot writes no state; past it the session intent
 * is durable, each heavy phase then waits in the node queue, and a queued refusal tears the pod down and frees the slot.
 * The acknowledged draft is restored as-is. */
export async function revive(ports: LivePorts, key: LiveKey, phase: 'revive' | 'crash_restore' = 'revive') {
  const binding = await currentBinding(ports, key);
  const draft = await ports.drafts.current(key, binding.generation);
  if (draft.generation !== binding.generation) conflict('stale_fence');
  const revision = liveRevision(draft.revision);
  const invitation = await ports.invitations.current(key, binding.generation);
  // The acting user is the binding owner: admission is fair across owners.
  await ports.admission.acquire(key, binding.ownerId);
  try {
    const runtime = await ports.store.transaction(key, async unit => {
      const previous = unit.state;
      if (previous && previous.runtime.phase !== 'DORMANT') conflict('transition_busy');
      const epoch = (previous?.runtime.leaseEpoch ?? 0) + 1;
      const now = ports.now();
      const runtime: LiveRuntime = { generation: binding.generation, ownerId: binding.ownerId,
        sessionId: ports.id(), phase: 'REVIVING', leaseEpoch: epoch, rowVersion: previous?.runtime.rowVersion ?? 0,
        podName: podName(key), podUid: null, sourceRevision: revision, appliedRevision: null,
        baseHeadSha: draft.baseHeadSha, liveTreeSha: draft.treeSha, lastAccessAt: now,
        routeEpoch: (previous?.runtime.routeEpoch ?? 0) + 1, invitationEpoch: invitation.epoch,
        invitationExpiresAt: invitation.expiresAt, pendingWake: false, attempt: null,
        crashRestores: phase === 'crash_restore' ? (previous?.runtime.crashRestores ?? 0) + 1 : 0 };
      const progress = previous?.progress.generation === binding.generation ? previous.progress : {
        generation: binding.generation, latestVerifiedHeadSha: binding.headSha, progressSeq: 0,
        publicationBaselineHeadSha: binding.headSha, publicationBaselineSeq: 0, lastProgressEventId: null,
        lastSuccessfulReleaseId: null, initialUnpublishedBranchEligible: binding.initialUnpublishedBranchEligible,
      };
      unit.save({ runtime, progress });
      return structuredClone(runtime);
    });
    try { return await prepareLive(ports, key, runtime); }
    catch (error) { await failed(ports, key, runtime, error); throw error; }
  } catch (error) { await releaseIfDormant(ports, key); throw error; }
}

const MAX_CRASH_RESTORES = 2;
/** OOM kill or eviction of a LIVE pod (A-LIVE §5.5): drafts are durable before ACK, so once teardown has confirmed
 * the old pod deleted, a fenced replacement restores the acknowledged revision. Bounded, so a pod that keeps
 * crashing cannot monopolize the heavy-phase queue; the next owner edit or start revives it then. */
export async function crashRestore(ports: LivePorts, key: LiveKey, error: unknown) {
  if (!(error instanceof LiveError) || error.code !== 'builder_unavailable') return;
  const stored = await ports.store.read(key);
  if (stored?.runtime.phase !== 'DORMANT' || (stored.runtime.crashRestores ?? 0) >= MAX_CRASH_RESTORES) return;
  try { return await revive(ports, key, 'crash_restore'); }
  catch { /* Queued or refused: the durable draft waits for the next owner edit or start. */ }
}
