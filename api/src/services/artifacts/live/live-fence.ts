import { FENCE_HEADER, MIN_KEY_BYTES, signLiveFence } from '@sentropic/artifacts/live-host';
import type { LivePorts } from './ports';
import { LiveError } from './records';

/** A-LIVE §8.2 controller push path on artifact-content (`LIVE_FENCE_PATH`), internal Service Host only. */
export const LIVE_FENCE_PATH = '/_live-fence/v1';
/** Per-environment live edge base (not secret), e.g. http://artifact-content.sentropic-preprod.svc.cluster.local:8791. */
export const LIVE_EDGE_URL_ENV = 'ARTIFACT_LIVE_EDGE_INTERNAL_URL';
/** `<kid>=<unpadded base64url>`: the same bytes as one APP_ARTIFACT_LIVE_CONTROLLER_KEYS entry of artifact-content
 * (owner sentropic, environment secret; rotation: README « Controller fence key »). */
export const LIVE_CONTROLLER_KEY_ENV = 'ARTIFACT_LIVE_CONTROLLER_KEY';
/** f1 lifetime: the edge refuses any fence whose exp - iat exceeds 300 s. */
export const FENCE_LIFETIME_SECONDS = 60;
/** Non-204 answers are retried with a fresh signature (the fence is idempotent at the edge), then refused. */
export const FENCE_RETRY_BACKOFF_MS = Object.freeze([250, 500, 1_000, 2_000]);
const KID = /^[A-Za-z0-9_-]{1,64}$/;
const SERVICE_HOST = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.svc\.cluster\.local$/;
const unconfigured = (): never => { throw new LiveError('builder_unavailable', 'fence_unconfigured'); };
const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

export interface ControllerFenceKey { readonly kid: string; readonly key: Uint8Array }
/** The controller fence key of this environment; an absent or invalid value refuses to compose (never echoes it). */
export function controllerFenceKey(env: Readonly<Record<string, string | undefined>>): ControllerFenceKey {
  const value = env[LIVE_CONTROLLER_KEY_ENV]?.trim() ?? '';
  const at = value.indexOf('='); const kid = value.slice(0, at); const material = value.slice(at + 1);
  if (at < 1 || !KID.test(kid) || !/^[A-Za-z0-9_-]+$/.test(material)) return unconfigured();
  const key = Buffer.from(material, 'base64url');
  return key.length >= MIN_KEY_BYTES ? Object.freeze({ kid, key }) : unconfigured();
}
/** http only, no credentials, query, fragment or path, host `<service>.<namespace>.svc.cluster.local`: never a public
 * content or pages Host, where the edge serves no fence. */
export function liveEdgeUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env[LIVE_EDGE_URL_ENV] ?? '';
  if (!value || /[?#@]/.test(value)) return unconfigured();
  let url: URL;
  try { url = new URL(value); } catch { return unconfigured(); }
  if (url.protocol !== 'http:' || url.pathname !== '/' || !SERVICE_HOST.test(url.hostname)) unconfigured();
  return url.origin;
}

/**
 * `routes` of the live controller (f1 signer): every revoke and ready pushes the runtime's generation and route epoch
 * floor to the live edge, so it closes every route and socket below it (A-LIVE §8.2). The edge applies a fence
 * idempotently, so a non-204 answer or a network error is resent, freshly signed, then refused as builder_unavailable.
 */
export function createLiveFenceRoutes(options: {
  baseUrl: string; key: ControllerFenceKey; now(): number; fetch?: typeof fetch; backoffMs?: readonly number[];
}): LivePorts['routes'] {
  const target = `${liveEdgeUrl({ [LIVE_EDGE_URL_ENV]: options.baseUrl })}${LIVE_FENCE_PATH}`;
  const backoff = options.backoffMs ?? FENCE_RETRY_BACKOFF_MS;
  async function push(artifactId: string, generation: number, routeEpoch: number) {
    for (const delay of [...backoff, undefined]) {
      const iat = Math.floor(options.now() / 1000);
      const token = signLiveFence({ v: 1, kid: options.key.kid, artifactId, generation, routeEpoch, iat,
        exp: iat + FENCE_LIFETIME_SECONDS }, options.key.key);
      const status = await (options.fetch ?? fetch)(target, { method: 'POST', redirect: 'error',
        headers: { [FENCE_HEADER]: token }, signal: AbortSignal.timeout(5_000) })
        .then(async response => { await response.body?.cancel(); return response.status; }, () => 0);
      if (status === 204) return;
      if (delay === undefined) throw new LiveError('builder_unavailable', 'fence_unconfirmed');
      await wait(delay);
    }
  }
  return {
    revoke: (key, runtime) => push(key.artifactId, runtime.generation, runtime.routeEpoch),
    ready: (key, runtime) => push(key.artifactId, runtime.generation, runtime.routeEpoch),
  };
}
