/**
 * BR-72 DEPTH Lot 1 — REAL-NETWORK GitHub executors.
 *
 * DELIBERATE deviation from the read-only benchmark proof's
 * synthetic-fixture rule (see `./adapter.ts`, `./fixtures.ts`): this module
 * calls the REAL `https://api.github.com` REST API using the Node 22 global
 * `fetch`, proving one connector can invoke a live API end-to-end through the
 * Sentropic adapter + a minimal broker context (`./live-adapter.ts`,
 * `./live-broker.ts`).
 *
 * NEVER log or echo a token. Non-2xx responses are mapped to a typed
 * `GithubLiveApiError`; the token itself never appears in any error message.
 */

const GITHUB_API_BASE = 'https://api.github.com';

export class GithubLiveApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retriable: boolean;

  constructor(status: number, code: string, message: string, retriable: boolean) {
    super(message);
    this.name = 'GithubLiveApiError';
    this.status = status;
    this.code = code;
    this.retriable = retriable;
  }
}

function buildHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sentropic-mcp-connector-github',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// S4: reject `.`, `..`, and empty segments in owner/repo/path BEFORE building
// any URL — encodeURIComponent does not encode `.`, and `..` survives it;
// the WHATWG URL parser collapses dot-segments, which can retarget the
// endpoint.
const INVALID_SEGMENT_VALUES = new Set(['', '.', '..']);

function assertValidSegment(kind: string, value: string): void {
  if (INVALID_SEGMENT_VALUES.has(value)) {
    throw new GithubLiveApiError(
      400,
      'github_invalid_input',
      `Invalid ${kind} segment: "${value}" is not permitted (empty, "." and ".." are rejected).`,
      false,
    );
  }
}

// S1 (timeout) + S3 (transport failures): the fetch() call itself (as opposed
// to a non-2xx response) can throw — AbortSignal.timeout expiring, a raw
// network failure, a TypeError, etc. Normalize every such throw to a typed
// GithubLiveApiError with retriable: true, so callers never see a raw
// rejection for a transient/transport condition.
async function githubFetch(path: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API_BASE}${path}`, {
      headers: buildHeaders(token),
      // S1: 10s request timeout — maps to AbortError/TimeoutError below.
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const isTimeout = name === 'AbortError' || name === 'TimeoutError';
    const message = err instanceof Error ? err.message : String(err);
    throw new GithubLiveApiError(
      0,
      isTimeout ? 'github_request_timeout' : 'github_transport_error',
      `GitHub API ${path} failed: ${message}`,
      true,
    );
  }
  if (!response.ok) {
    // S2: 429 is always retriable (primary + secondary rate limits); a 403
    // carrying either `x-ratelimit-remaining: 0` or a `Retry-After` header is
    // also a rate-limit condition and thus retriable.
    const hasRetryAfter = response.headers.get('retry-after') !== null;
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' || hasRetryAfter));
    const retriable = response.status >= 500 || rateLimited;
    let bodyMessage = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) {
        bodyMessage = body.message;
      }
    } catch {
      // Non-JSON error body — keep statusText.
    }
    throw new GithubLiveApiError(
      response.status,
      `github_api_error_${response.status}`,
      `GitHub API ${path} failed: ${response.status} ${bodyMessage}`,
      retriable,
    );
  }
  return response.json();
}

export type GetRepositoryInput = { owner: string; repo: string };

/** GET /repos/{owner}/{repo} — public, no auth required. */
export async function getRepositoryLive(input: GetRepositoryInput, token: string): Promise<unknown> {
  assertValidSegment('owner', input.owner);
  assertValidSegment('repo', input.repo);
  return githubFetch(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
    token,
  );
}

// M2: the manifest declares `search_repositories`'s required input field as
// `query` (see ../src/manifest.ts) — the executor must read that field, not
// an undeclared `q` shorthand.
export type SearchRepositoriesInput = { query: string };

/** GET /search/repositories?q={query} — public, no auth required. */
export async function searchRepositoriesLive(
  input: SearchRepositoriesInput,
  token: string,
): Promise<unknown> {
  const query = input?.query;
  if (!query) {
    throw new GithubLiveApiError(
      400,
      'github_invalid_input',
      'search_repositories requires a non-empty "query" input field.',
      false,
    );
  }
  const params = new URLSearchParams({ q: query });
  return githubFetch(`/search/repositories?${params.toString()}`, token);
}

/** GET /user — REQUIRES a token. */
export async function getCurrentUserLive(token: string): Promise<unknown> {
  if (!token) {
    throw new GithubLiveApiError(
      401,
      'github_missing_token',
      'get_current_user requires a GitHub token (ctx.getSecret("githubAccessToken")).',
      false,
    );
  }
  return githubFetch('/user', token);
}

export type GetFileContentsInput = { owner: string; repo: string; path: string };

/** GET /repos/{owner}/{repo}/contents/{path} — public, no auth required. */
export async function getFileContentsLive(
  input: GetFileContentsInput,
  token: string,
): Promise<unknown> {
  assertValidSegment('owner', input.owner);
  assertValidSegment('repo', input.repo);
  const segments = input.path.split('/');
  for (const segment of segments) {
    assertValidSegment('path', segment);
  }
  const encodedPath = segments.map(encodeURIComponent).join('/');
  return githubFetch(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}`,
    token,
  );
}
