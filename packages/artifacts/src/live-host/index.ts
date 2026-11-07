/** `@sentropic/artifacts/live-host`: the single home of the code the live host runs or verifies (A-LIVE v2 §8).
 * api, artifact-content and the content host (immo) import it; none re-implements a digest, a signature or a recheck. */
export { CANDIDATE_DIGEST_TAG, CANDIDATE_LIMITS, candidateDigest, candidatePath, type CandidateFile } from './candidate.js';
export { LIVE_HOST_ERROR_CODES, LiveHostError, type LiveHostErrorCode } from './errors.js';
export { LIVE_KEY_ID, liveKeyId, type KeyResolver, type SigningKey } from './keys.js';
export {
  HANDOFF_LIFETIME_MS, jobKey, sealHandoff, verifyReceipt, type Handoff, type HandoffClaims, type HandoffInput, type HandoffReceipt,
} from './handoff.js';
export {
  publicationRecheck, RECHECK_REFUSALS, resolvePendingJob, type AttemptFence, type HostJob, type HostRecheckView, type RecheckRefusal,
} from './recheck.js';
export { acceptHandoff, type AcceptOptions, type HostLedger } from './accept.js';
export {
  encodeHandoffRequest, HOST_BUILD_PATHS, JOB_REQUEST_LIFETIME_MS, parseHandoffRequest, refusalFrom, refusalOf, sealJobRequest,
  verifyJobRequest, type HostBuildRefusal, type HostCandidateFile, type HostHandoffRequest, type HostHandoffResponse,
  type HostJobClaims, type HostJobRequest, type HostJobResponse,
} from './api.js';
export {
  ASSERTION_HEADER, CONTROL_HEADER, FENCE_HEADER, MAX_ASSERTION_SECONDS, MAX_CONTROL_SECONDS, MAX_SKEW_SECONDS,
  MAX_SOURCE_REVISION_LENGTH, MIN_KEY_BYTES, signLiveAssertion, signLiveControl, signLiveFence, verifyLiveAssertion,
  verifyLiveControl, verifyLiveFence, type LiveAssertionClaims, type LiveControlClaims, type LiveFenceClaims, type VerifyOptions,
} from './live-format.js';
