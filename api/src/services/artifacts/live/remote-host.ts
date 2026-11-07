import { encodeHandoffRequest, HOST_BUILD_PATHS, refusalFrom, sealJobRequest, type HandoffReceipt, type HostJob,
  type LiveHostError, type SigningKey } from '@sentropic/artifacts/live-host';
import type { RemoteHost } from './handoff-publication';
import { LiveError } from './records';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hostJob = (value: unknown): value is HostJob => record(value) && typeof value.jobId === 'string'
  && Number.isSafeInteger(value.generation) && typeof value.headSha === 'string'
  && (value.expectedReleaseId === null || typeof value.expectedReleaseId === 'string');
/** Any answer that is neither a v1 success nor a closed refusal: the outcome is unknown, so the caller may resend. */
const transport = (): never => { throw new Error('host_transport_failure'); };
/** s-archi 16:35: the host may record the pending job just after the builder's first resolution. Only a 409
 * job_not_pending is retried, freshly signed, with bounded backoff (6 tries over 7.75 s), then it fails for good. */
export const JOB_NOT_PENDING_BACKOFF_MS = Object.freeze([250, 500, 1_000, 2_000, 4_000]);
const notPending = (status: number, refusal: LiveHostError) => status === 409 && refusal.code === 'handoff_mismatch'
  && refusal.reason === 'job_not_pending';
const never = () => false;
const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/** Builder-side client of the content host build endpoints (live-host HOST_BUILD_PATHS, A-LIVE §8.4). The base URL comes
 * from the host configuration. A closed refusal body rejects with LiveHostError; any other failure is a transport error. */
export function createHttpRemoteHost(options: {
  baseUrl: string; signingKey(): SigningKey; now(): number; fetch?: typeof fetch; timeoutMs?: number;
}): RemoteHost {
  let base: URL;
  try { base = new URL(options.baseUrl); } catch { throw new LiveError('builder_unavailable', 'host_unconfigured'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || options.baseUrl.includes('#')) {
    throw new LiveError('builder_unavailable', 'host_unconfigured');
  }
  const root = base.href.replace(/\/+$/, '');
  async function call(path: string, body: () => unknown, retry: typeof notPending = never): Promise<Record<string, unknown>> {
    for (const delay of [...JOB_NOT_PENDING_BACKOFF_MS, undefined]) {
      const response = await (options.fetch ?? fetch)(`${root}${path}`, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
      const payload: unknown = await response.json().catch(() => undefined);
      if (response.ok && record(payload) && payload.v === 1) return payload;
      const refusal = refusalFrom(payload) ?? transport();
      if (delay === undefined || !retry(response.status, refusal)) throw refusal;
      await wait(delay);
    }
    return transport();
  }
  return {
    async job(key, jobId, fence) {
      const { job } = await call(HOST_BUILD_PATHS.job, () => sealJobRequest({ scopeId: key.storageScopeId,
        artifactId: key.artifactId, jobId, fence }, options.signingKey(), options.now()), notPending);
      return hostJob(job) ? job : transport();
    },
    async accept(_key, handoff, files) {
      const { receipt } = await call(HOST_BUILD_PATHS.handoff, () => encodeHandoffRequest(handoff, files));
      // verifyReceipt (handoff publication) authenticates the receipt; only its presence is checked here.
      return record(receipt) ? receipt as unknown as HandoffReceipt : transport();
    },
  };
}
/** Env name of the content host build API base, per environment (owner sentropic, no secret). Preprod:
 * `https://preprod.immo.sent-tech.ca/api/v1/artifacts`, so the builder calls `<base>/live-host/v1/{job,handoff}`. */
export const BUILDER_REMOTE_HOST_ENV = 'ARTIFACT_BUILDER_REMOTE_HOST_URL';
/** The configured content host; an absent or invalid base refuses to compose the builder service. */
export function builderRemoteHost(env: Readonly<Record<string, string | undefined>>,
  options: Omit<Parameters<typeof createHttpRemoteHost>[0], 'baseUrl'>): RemoteHost {
  return createHttpRemoteHost({ ...options, baseUrl: env[BUILDER_REMOTE_HOST_ENV] ?? '' });
}
