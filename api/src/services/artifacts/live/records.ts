/** A-LIVE records are host state, never tool definitions or release-profile keys. */
export interface LiveKey { storageScopeId: string; artifactId: string }
export type LivePhase = 'DORMANT' | 'REVIVING' | 'LIVE' | 'QUIESCING' | 'BUILD_PROVISIONING'
  | 'BUILDING' | 'VERIFYING' | 'PUBLISHING' | 'SAVING' | 'DECOMMISSIONING' | 'RECOVERING' | 'FAILED';
export interface LiveRuntime {
  generation: number; ownerId: string; sessionId: string; phase: LivePhase;
  leaseEpoch: number; rowVersion: number; podUid: string | null; podName: string;
  sourceRevision: number; appliedRevision: number | null; baseHeadSha: string;
  liveTreeSha: string; lastAccessAt: number; maximumLifetimeAt: number;
  routeEpoch: number; pendingWake: boolean; attempt: LiveAttempt | null;
  stateDetail?: string;
}
export interface PublicationProgress {
  generation: number; latestVerifiedHeadSha: string; progressSeq: number;
  publicationBaselineHeadSha: string; publicationBaselineSeq: number;
  lastProgressEventId: string | null; lastSuccessfulReleaseId: string | null;
  initialUnpublishedBranchEligible: boolean;
}
export interface LiveAttempt {
  id: string; headSha: string; treeSha: string; startedAt: number;
  leaseEpoch: number; routeEpoch: number; expectedReleaseId: string | null;
  progressSeq: number; baselineSeq: number; initial: boolean;
  kind: 'idle' | 'explicit'; candidateDigest?: string;
}
export interface LiveState { runtime: LiveRuntime; progress: PublicationProgress }
export class LiveError extends Error {
  constructor(readonly code: string, readonly reason?: string) { super(code); }
}
export function conflict(reason: string): never { throw new LiveError('git_live_conflict', reason); }
export function assertFence(state: LiveState | undefined, fence: LiveRuntime): asserts state is LiveState {
  if (!state || state.runtime.generation !== fence.generation || state.runtime.sessionId !== fence.sessionId
    || state.runtime.leaseEpoch !== fence.leaseEpoch || state.runtime.routeEpoch !== fence.routeEpoch) conflict('stale_fence');
}
export function automaticEligible(progress: PublicationProgress, attempt: LiveAttempt, releaseCommit: string | null) {
  return attempt.headSha === progress.latestVerifiedHeadSha && attempt.headSha !== releaseCommit
    && (progress.progressSeq > progress.publicationBaselineSeq || progress.initialUnpublishedBranchEligible);
}

/** Called only with a trusted, policy-admitted fast-forward observation. */
export function recordHead(progress: PublicationProgress, head: string, eventId: string) {
  if (head === progress.latestVerifiedHeadSha || progress.lastProgressEventId === eventId) return;
  progress.latestVerifiedHeadSha = head;
  progress.progressSeq++;
  progress.lastProgressEventId = eventId;
}
/** Must share the successful release/index/receipt transaction, including explicit historical publish. */
export function publicationBaseline(progress: PublicationProgress, releaseId: string) {
  progress.publicationBaselineHeadSha = progress.latestVerifiedHeadSha;
  progress.publicationBaselineSeq = progress.progressSeq;
  progress.lastSuccessfulReleaseId = releaseId;
  progress.initialUnpublishedBranchEligible = false;
}
