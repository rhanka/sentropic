import { CANDIDATE_LIMITS, candidatePath, type CandidateFile } from './candidate.js';
import { LIVE_HOST_ERROR_CODES, LiveHostError, type LiveHostErrorCode } from './errors.js';
import { count, record, signed, text, valid, type Handoff, type HandoffReceipt } from './handoff.js';
import { assertSigner, liveKeyId, type KeyResolver, type SigningKey } from './keys.js';
import { RECHECK_REFUSALS, type AttemptFence, type HostJob, type RecheckRefusal } from './recheck.js';

/** Host build API (A-LIVE §8.4): the trusted builder calls the content host to resolve its pending job, then to submit
 * the sealed handoff with the exact candidate bytes. JSON bodies; paths are relative to the host-configured base URL. */
export const HOST_BUILD_PATHS = Object.freeze({ job: '/live-host/v1/job', handoff: '/live-host/v1/handoff' });
export const JOB_REQUEST_LIFETIME_MS = 60_000;
const JOB_SKEW_MS = 5_000; const JOB_TAG = 'sentropic.sg4b.job.v1\n';

/** Signed by the builder key, so no unauthenticated caller can advance the attempt fence. */
export interface HostJobClaims {
  v: 1; kid: string; scopeId: string; artifactId: string; jobId: string; fence: AttemptFence; iat: number; exp: number;
}
export interface HostJobRequest { claims: HostJobClaims; signature: string }
export interface HostJobResponse { v: 1; job: HostJob }
export interface HostCandidateFile { path: string; base64: string }
export interface HostHandoffRequest { v: 1; handoff: Handoff; files: HostCandidateFile[] }
export interface HostHandoffResponse { v: 1; receipt: HandoffReceipt }
/** Every host refusal body: a closed code, never caller text. Any other failure is a transport failure (unknown outcome). */
export interface HostBuildRefusal { v: 1; error: LiveHostErrorCode; reason?: RecheckRefusal }

export function sealJobRequest(input: Pick<HostJobClaims, 'scopeId' | 'artifactId' | 'jobId' | 'fence'>, signer: SigningKey, now: number): HostJobRequest {
  assertSigner(signer);
  const claims: HostJobClaims = { v: 1, kid: signer.kid, ...input, iat: now, exp: now + JOB_REQUEST_LIFETIME_MS };
  return { claims, signature: signed(JOB_TAG, claims, signer.key) };
}
const invalid = (): never => { throw new LiveHostError('request_invalid'); };
/** Host side: authenticated, fresh, for this host scope. The host then runs `resolvePendingJob` on its locked rows. */
export function verifyJobRequest(request: unknown, options: { scopeId: string; builderKeys: KeyResolver; now: number }): HostJobClaims {
  const body = record(request) ? request : undefined; const claims = body?.claims;
  if (!record(claims) || claims.v !== 1 || !liveKeyId(claims.kid)
    || !valid(JOB_TAG, claims, body?.signature, options.builderKeys(claims.kid))) return invalid();
  const c = claims as unknown as HostJobClaims;
  if (!text(c.scopeId) || !text(c.artifactId) || !text(c.jobId) || !record(c.fence) || !text(c.fence.runId) || !count(c.fence.attempt)
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.exp - c.iat > JOB_REQUEST_LIFETIME_MS
    || c.iat > options.now + JOB_SKEW_MS || c.exp <= options.now) return invalid();
  if (c.scopeId !== options.scopeId) throw new LiveHostError('handoff_mismatch', 'scope_mismatch');
  return c;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/; const MAX_BASE64 = Math.ceil(CANDIDATE_LIMITS.fileBytes / 3) * 4;
export const encodeHandoffRequest = (handoff: Handoff, files: readonly CandidateFile[]): HostHandoffRequest =>
  ({ v: 1, handoff, files: files.map(file => ({ path: file.path, base64: Buffer.from(file.bytes).toString('base64') })) });
/** Host side: strict shape and canonical base64 only. acceptHandoff then authenticates and digests the bytes. */
export function parseHandoffRequest(body: unknown): { handoff: Handoff; files: CandidateFile[] } {
  if (!record(body) || body.v !== 1 || !record(body.handoff) || !Array.isArray(body.files) || body.files.length < 1
    || body.files.length > CANDIDATE_LIMITS.files) return invalid();
  const files = body.files.map((file: unknown) => {
    if (!record(file) || Object.keys(file).sort().join() !== 'base64,path' || !candidatePath(file.path)
      || typeof file.base64 !== 'string' || file.base64.length > MAX_BASE64 || !BASE64.test(file.base64)) return invalid();
    const bytes = Buffer.from(file.base64, 'base64');
    return bytes.toString('base64') === file.base64 ? { path: file.path, bytes: new Uint8Array(bytes) } : invalid();
  });
  return { handoff: body.handoff as unknown as Handoff, files };
}

/** Host side: the body for a LiveHostError; undefined for any other error (answer a generic failure). */
export const refusalOf = (error: unknown): HostBuildRefusal | undefined => error instanceof LiveHostError
  ? { v: 1, error: error.code, ...(error.reason ? { reason: error.reason } : {}) } : undefined;
/** Builder side: a host refusal from a closed code set; undefined means no refusal (unknown outcome, resend). */
export function refusalFrom(body: unknown): LiveHostError | undefined {
  if (!record(body) || body.v !== 1 || !(LIVE_HOST_ERROR_CODES as readonly unknown[]).includes(body.error)
    || (body.reason !== undefined && !(RECHECK_REFUSALS as readonly unknown[]).includes(body.reason))) return undefined;
  return new LiveHostError(body.error as LiveHostErrorCode, body.reason as RecheckRefusal | undefined);
}
