import type { HandoffClaims } from './handoff';

/** Host state read INSIDE the host publication transaction, on the locked binding and job rows (A-LIVE §8.3).
 * Pure and dependency-free: the host composes it as the `expect()` of acceptHandoff. */
export interface AttemptFence { runId: string; attempt: number }
export interface HostRecheckView {
  /** Authenticated host scope; never taken from the handoff. */
  scopeId: string;
  /** Operator pause or kill switch for sandbox publication. */
  killSwitch: boolean;
  /** Exact builder image digest strings (A-LIVE §8.1). */
  imageAllowlist: readonly string[];
  currentReleaseId: string | null;
  /** The required head is reachable on the bound branch, observed in this transaction. */
  headReachable: boolean;
  binding: { artifactId: string; state: string; generation: number; executor: string; autoPublish: boolean;
    pendingJobId: string | null; pendingCommitSha: string | null };
  /** The persisted G0 v3 §2.6 job; `fence` is the attempt last admitted by `resolvePendingJob`. */
  job: { jobId: string; state: string; bindingGeneration: number; commitSha: string; expectedCurrentReleaseId: string | null;
    fence: AttemptFence | null } | undefined;
  /** Current owner/code rights and host write scope; the automatic policy and the §5.3.1 progress predicate. */
  policy: { ownerAuthorized: boolean; automaticAuthorized: boolean; automaticEligible: boolean };
}
export type RecheckRefusal = 'scope_mismatch' | 'publication_paused' | 'generation_mismatch' | 'job_not_pending'
  | 'attempt_fenced' | 'policy_refused' | 'head_unreachable' | 'release_conflict' | 'image_not_allowed';

function pending(view: HostRecheckView, jobId: string, generation: number) {
  const { binding, job } = view;
  return job !== undefined && ['build_pending', 'building'].includes(job.state) && binding.state === 'build_pending'
    && binding.executor === 'sandbox' && binding.pendingJobId === jobId && job.jobId === jobId
    && binding.generation === generation && job.bindingGeneration === generation
    && binding.pendingCommitSha === job.commitSha ? job : undefined;
}
/** Every §8.3 final recheck, in order; null admits. */
export function publicationRecheck(view: HostRecheckView, claims: HandoffClaims): RecheckRefusal | null {
  if (claims.scopeId !== view.scopeId || claims.artifactId !== view.binding.artifactId) return 'scope_mismatch';
  if (view.killSwitch || view.binding.state === 'paused') return 'publication_paused';
  if (claims.generation !== view.binding.generation) return 'generation_mismatch';
  const job = pending(view, claims.jobId, claims.generation);
  if (!job || job.commitSha !== claims.commitSha) return 'job_not_pending';
  if (job.fence?.runId !== claims.runId || job.fence.attempt !== claims.attempt) return 'attempt_fenced';
  if (claims.kind === 'explicit' ? !view.policy.ownerAuthorized
    : !(view.binding.autoPublish && view.policy.automaticAuthorized && view.policy.automaticEligible)) return 'policy_refused';
  if (!view.headReachable) return 'head_unreachable';
  if (claims.expectedReleaseId !== job.expectedCurrentReleaseId || view.currentReleaseId !== job.expectedCurrentReleaseId) return 'release_conflict';
  if (!view.imageAllowlist.includes(claims.tuple.builderImageDigest)) return 'image_not_allowed';
  return null;
}
/** Host side of the builder's job resolution: only the binding's pending job at its generation, never a caller SHA.
 * The attempt fence is monotonic; the host persists the returned fence on the job in the same transaction. */
export function resolvePendingJob(view: HostRecheckView, jobId: string, fence: AttemptFence) {
  const job = pending(view, jobId, view.binding.generation);
  if (!job || !Number.isSafeInteger(fence.attempt) || fence.attempt < 1 || (job.fence && (fence.attempt < job.fence.attempt
    || (fence.attempt === job.fence.attempt && fence.runId !== job.fence.runId)))) return null;
  return { resolved: { jobId, generation: job.bindingGeneration, headSha: job.commitSha, expectedReleaseId: job.expectedCurrentReleaseId },
    fence: { runId: fence.runId, attempt: fence.attempt } };
}
