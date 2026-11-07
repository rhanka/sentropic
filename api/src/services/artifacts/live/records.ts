import type { ArtifactBuildTuple } from '@sentropic/artifacts/server/build-contract';
/** A-LIVE records are host state, never tool definitions or release-profile keys. */
export interface LiveKey { storageScopeId: string; artifactId: string }
/** BUILD_QUEUED: the live stopped, the pod is prepared and its clean build waits durably in the node queue. */
export type LivePhase = 'DORMANT' | 'REVIVING' | 'LIVE' | 'QUIESCING' | 'BUILD_PROVISIONING' | 'BUILD_QUEUED'
  | 'BUILDING' | 'VERIFYING' | 'PUBLISHING' | 'SAVING' | 'DECOMMISSIONING' | 'RECOVERING' | 'FAILED';
export interface LiveRuntime {
  generation: number; ownerId: string; sessionId: string; phase: LivePhase;
  leaseEpoch: number; rowVersion: number; podUid: string | null; podName: string;
  sourceRevision: string; appliedRevision: string | null; baseHeadSha: string;
  liveTreeSha: string; lastAccessAt: number;
  routeEpoch: number; invitationEpoch: number; invitationExpiresAt: number | null; pendingWake: boolean; attempt: LiveAttempt | null;
  stateDetail?: string;
  /** Consecutive automatic crash restores of this binding; a normal revive resets it. */
  crashRestores?: number;
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
  /** Server-side §8.4 evidence join from the pinned inputs; publication requires it with the candidate digest. */
  evidence?: ArtifactBuildTuple;
}
export interface LiveState { runtime: LiveRuntime; progress: PublicationProgress }
/** A-LIVE Amendment 1: idle strictly after 900 s of server time since lastAccessAt. There is no absolute lifetime. */
export const IDLE_THRESHOLD_MS = 900_000;
export const idleDeadline = (runtime: Pick<LiveRuntime, 'lastAccessAt'>) => runtime.lastAccessAt + IDLE_THRESHOLD_MS;
/** Liveness lease (Amendment 1 §3): one fenced supervisor frame at least this often while a runtime is not DORMANT. */
export const LEASE_FRAME_INTERVAL_MS = 60_000;
/** Revisions are opaque strings owned by the package LiveService, bounded like the host live assertion
 * (`MAX_SOURCE_REVISION_LENGTH` in `@sentropic/artifacts/live-host`). */
export const LIVE_REVISION_MAX_LENGTH = 256;
export class LiveError extends Error {
  constructor(readonly code: string, readonly reason?: string) { super(code); }
}
export function conflict(reason: string): never { throw new LiveError('git_live_conflict', reason); }
export function liveRevision(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIVE_REVISION_MAX_LENGTH) conflict('invalid_revision');
  return value;
}
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
