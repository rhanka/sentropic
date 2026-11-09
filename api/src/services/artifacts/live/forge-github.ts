import type { BuilderRepository, ForgeConfig } from './forge-binding';
import { LiveError } from './records';

export const GITHUB_API = 'https://api.github.com';
/** The only redirect target of a tarball read. */
export const CODELOAD = 'https://codeload.github.com/';
export const FORGE_TIMEOUTS = Object.freeze({ callMs: 30_000, tarballMs: 120_000 });
/** A cached lease is used until 60 s before its expiry. */
export const LEASE_MARGIN_MS = 60_000;
export const USER_AGENT = 'sentropic-artifact-builder';
const HEADERS = Object.freeze({ accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
  'user-agent': USER_AGENT });
export const unavailable = (): never => { throw new LiveError('builder_unavailable', 'forge_unavailable'); };
export const discard = async (response: Response) => { try { await response.body?.cancel(); } catch { /* closed */ } };
/** The JSON body of a 200 answer; any other status or body is builder_unavailable, with its status as reason. */
export const json = async (response: Response): Promise<Record<string, unknown>> => {
  if (response.status !== 200) { await discard(response);
    throw new LiveError('builder_unavailable', `forge_status_${response.status}`); }
  try { return await response.json() as Record<string, unknown>; } catch { return unavailable(); }
};
export const field = (value: unknown, name: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined;

/**
 * GitHub REST GETs under the in-process SG0-app lease (contract §3): the token is cached per (storageScopeId, repoId)
 * until its expiry minus 60 s, dropped on a credential invalidation event and on 401/403, and never leaves this module.
 */
export function createLeasedGitHub(options: { config: ForgeConfig; fetch: typeof fetch; now: () => number }) {
  const { config, now } = options;
  const leases = new Map<string, { token: string; refreshAt: number }>();
  const leaseKey = (scope: string, repoId: string) => JSON.stringify([scope, repoId]);
  const close = config.host.subscribe(async event => { leases.delete(leaseKey(event.storageScopeId, event.repoId)); });

  async function token(repository: BuilderRepository, fresh: boolean) {
    const k = leaseKey(repository.storageScopeId, repository.repoId); const cached = leases.get(k);
    if (!fresh && cached && now() < cached.refreshAt) return cached.token;
    leases.delete(k);
    let lease: { token: string; expiresAt: string };
    try { lease = await config.host.acquire({ storageScopeId: repository.storageScopeId, repoId: repository.repoId,
      installationRef: repository.installationRef }); } catch { return unavailable(); }
    const expiresAt = Date.parse(lease.expiresAt);
    if (typeof lease.token !== 'string' || !lease.token || !Number.isFinite(expiresAt)) return unavailable();
    leases.set(k, { token: lease.token, refreshAt: expiresAt - LEASE_MARGIN_MS });
    return lease.token;
  }
  async function get(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
    // A transport error may carry the URL (a codeload URL holds a token): it is replaced, never rethrown.
    try { return await options.fetch(url, { method: 'GET', headers, redirect: 'manual', signal }); } catch { return unavailable(); }
  }
  /** One GitHub REST GET; 401/403 drops the cached token and retries once with a fresh lease. */
  async function github(repository: BuilderRepository, path: string, signal: AbortSignal): Promise<Response> {
    for (const fresh of [false, true]) {
      const bearer = await token(repository, fresh);
      const response = await get(`${GITHUB_API}/repos/${repository.locator}${path}`,
        { ...HEADERS, authorization: `Bearer ${bearer}` }, signal);
      if (response.status !== 401 && response.status !== 403) return response;
      leases.delete(leaseKey(repository.storageScopeId, repository.repoId)); await discard(response);
    }
    return unavailable();
  }
  return { github, get, close };
}
