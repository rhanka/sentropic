/**
 * BR-72 DEPTH Lot 1 — GitHub LIVE broker/adapter HERMETIC unit tests.
 *
 * Mocks global `fetch` — asserts `invokeGithubLive` constructs a working
 * in-memory `StpConnectorContext`, dispatches resource vs. tool capabilities
 * correctly, forwards a supplied token as a `Bearer` Authorization header
 * (and omits it when absent), and maps an unknown capability + a non-2xx
 * GitHub response to a typed error envelope. NO REAL NETWORK CALL — see
 * `../scripts/smoke-github-live.mjs` for the real-network proof (BR-72
 * DEPTH Lot 1's actual end-to-end evidence).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeGithubLive } from '../src/live-broker.js';
import { getFileContentsLive, getRepositoryLive } from '../src/live-executors.js';

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'mock',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }));
}

describe('github live broker (BR-72 DEPTH Lot 1, mocked fetch — no real network)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('get_repository: builds the correct URL, omits Authorization without a token, returns ok:true', async () => {
    const fetchSpy = mockFetchOnce(200, { full_name: 'octocat/Hello-World', stargazers_count: 42 });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_repository', { owner: 'octocat', repo: 'Hello-World' });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ full_name: 'octocat/Hello-World', stargazers_count: 42 });
    expect(result.auditId).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.github.com/repos/octocat/Hello-World');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('get_current_user: forwards a supplied opts.token as a Bearer Authorization header', async () => {
    const fetchSpy = mockFetchOnce(200, { login: 'octocat' });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_current_user', {}, { token: 'test-token-value' });

    expect(result.ok).toBe(true);
    expect((result.output as { login: string }).login).toBe('octocat');
    const [, init] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('Bearer test-token-value');
  });

  it('get_current_user: without a token, fails fast with a typed error and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_current_user', {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('github_missing_token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('search_repositories: dispatches as a tool (no resource uri wrapping), reading the manifest-declared "query" field', async () => {
    const fetchSpy = mockFetchOnce(200, { total_count: 1, items: [{ full_name: 'rhanka/sentropic' }] });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('search_repositories', { query: 'sentropic' });

    expect(result.ok).toBe(true);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://api.github.com/search/repositories?q=sentropic');
  });

  it('search_repositories: an empty/missing "query" is rejected as a typed error, without calling fetch (M2 guard)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const missing = await invokeGithubLive('search_repositories', {});
    const empty = await invokeGithubLive('search_repositories', { query: '' });

    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe('github_invalid_input');
    expect(empty.ok).toBe(false);
    expect(empty.error?.code).toBe('github_invalid_input');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps a non-2xx GitHub response to a typed, retriable-aware error envelope', async () => {
    const fetchSpy = mockFetchOnce(404, { message: 'Not Found' });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_repository', {
      owner: 'octocat',
      repo: 'does-not-exist',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('github_api_error_404');
    expect(result.error?.retriable).toBe(false);
  });

  it('a 5xx GitHub response maps to a typed error with retriable: true (S2/S3 regression lock)', async () => {
    const fetchSpy = mockFetchOnce(503, { message: 'Service Unavailable' });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_repository', { owner: 'octocat', repo: 'Hello-World' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('github_api_error_503');
    expect(result.error?.retriable).toBe(true);
  });

  it('a 429 GitHub response maps to a typed error with retriable: true (S2 regression lock)', async () => {
    const fetchSpy = mockFetchOnce(429, { message: 'Too Many Requests' });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('search_repositories', { query: 'sentropic' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('github_api_error_429');
    expect(result.error?.retriable).toBe(true);
  });

  it('a 403 response carrying Retry-After (secondary rate limit, no x-ratelimit-remaining) is retriable: true (S2)', async () => {
    const fetchSpy = mockFetchOnce(403, { message: 'You have exceeded a secondary rate limit' }, {
      'retry-after': '30',
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_repository', { owner: 'octocat', repo: 'Hello-World' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('github_api_error_403');
    expect(result.error?.retriable).toBe(true);
  });

  it('a raw fetch throw (transport failure) is normalized to a typed, retriable: true error (S3)', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_repository', { owner: 'octocat', repo: 'Hello-World' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('github_transport_error');
    expect(result.error?.retriable).toBe(true);
  });

  it('a fetch abort/timeout (AbortSignal.timeout expiring) is normalized to a typed, retriable: true error (S1)', async () => {
    const fetchSpy = vi.fn(async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('get_repository', { owner: 'octocat', repo: 'Hello-World' });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('github_request_timeout');
    expect(result.error?.retriable).toBe(true);
  });

  it('getRepositoryLive: rejects "." / ".." / empty owner-repo segments as a typed error, without calling fetch (S4)', async () => {
    // Exercises the executor directly (not through invokeGithubLive's
    // resource-URI round trip): the URI parser's `[^/]+` regex already
    // rejects a truly empty owner/repo before reaching the executor, so an
    // executor-level test is the precise place to lock in the S4 guard for
    // all three rejected values ('.', '..', '').
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    for (const [owner, repo] of [
      ['.', 'Hello-World'],
      ['octocat', '..'],
      ['', 'Hello-World'],
      ['octocat', ''],
    ] as const) {
      const result = await getRepositoryLive({ owner, repo }, '').catch((err) => err);
      expect(result).toBeInstanceOf(Error);
      expect((result as { code?: string }).code).toBe('github_invalid_input');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getFileContentsLive: rejects a "." / ".." / empty segment inside path, without calling fetch (S4)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    for (const path of ['src/../secrets.txt', 'src/./file.ts', 'src//file.ts', '/leading-slash.ts']) {
      const result = await getFileContentsLive({ owner: 'octocat', repo: 'Hello-World', path }, '').catch(
        (err) => err,
      );
      expect(result).toBeInstanceOf(Error);
      expect((result as { code?: string }).code).toBe('github_invalid_input');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects "." / ".." owner-repo segments through the full broker round trip too (S4, end-to-end)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const dotOwner = await invokeGithubLive('get_repository', { owner: '.', repo: 'Hello-World' });
    const dotDotRepo = await invokeGithubLive('get_repository', { owner: 'octocat', repo: '..' });

    expect(dotOwner.ok).toBe(false);
    expect(dotOwner.error?.code).toBe('github_invalid_input');
    expect(dotDotRepo.ok).toBe(false);
    expect(dotDotRepo.error?.code).toBe('github_invalid_input');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('unknown capability returns a typed error without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('delete_everything', {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unknown_live_capability');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
