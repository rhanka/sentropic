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

  it('search_repositories: dispatches as a tool (no resource uri wrapping) with the q param', async () => {
    const fetchSpy = mockFetchOnce(200, { total_count: 1, items: [{ full_name: 'rhanka/sentropic' }] });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('search_repositories', { q: 'sentropic' });

    expect(result.ok).toBe(true);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://api.github.com/search/repositories?q=sentropic');
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

  it('unknown capability returns a typed error without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await invokeGithubLive('delete_everything', {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unknown_live_capability');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
