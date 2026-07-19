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

async function githubFetch(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, { headers: buildHeaders(token) });
  if (!response.ok) {
    const rateLimited =
      response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
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
  return githubFetch(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
    token,
  );
}

export type SearchRepositoriesInput = { q: string };

/** GET /search/repositories?q={q} — public, no auth required. */
export async function searchRepositoriesLive(
  input: SearchRepositoriesInput,
  token: string,
): Promise<unknown> {
  const params = new URLSearchParams({ q: input.q });
  return githubFetch(`/search/repositories?${params.toString()}`, token);
}

/** GET /user — REQUIRES a token. */
export async function getCurrentUserLive(token: string): Promise<unknown> {
  if (!token) {
    throw new GithubLiveApiError(
      401,
      'github_missing_token',
      'get_current_user requires a GitHub token (ctx.getSecret("githubToken")).',
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
  const encodedPath = input.path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  return githubFetch(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}`,
    token,
  );
}
