import { encodeHandoffRequest, HOST_BUILD_PATHS, refusalFrom, sealJobRequest, type HandoffReceipt, type HostJob,
  type SigningKey } from '@sentropic/artifacts/live-host';
import type { RemoteHost } from './handoff-publication';
import { LiveError } from './records';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hostJob = (value: unknown): value is HostJob => record(value) && typeof value.jobId === 'string'
  && Number.isSafeInteger(value.generation) && typeof value.headSha === 'string'
  && (value.expectedReleaseId === null || typeof value.expectedReleaseId === 'string');
/** Any answer that is neither a v1 success nor a closed refusal: the outcome is unknown, so the caller may resend. */
const transport = (): never => { throw new Error('host_transport_failure'); };

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
  async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await (options.fetch ?? fetch)(`${root}${path}`, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok && record(payload) && payload.v === 1) return payload;
    throw refusalFrom(payload) ?? transport();
  }
  return {
    async job(key, jobId, fence) {
      const { job } = await call(HOST_BUILD_PATHS.job, sealJobRequest({ scopeId: key.storageScopeId, artifactId: key.artifactId,
        jobId, fence }, options.signingKey(), options.now()));
      return hostJob(job) ? job : transport();
    },
    async accept(_key, handoff, files) {
      const { receipt } = await call(HOST_BUILD_PATHS.handoff, encodeHandoffRequest(handoff, files));
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
