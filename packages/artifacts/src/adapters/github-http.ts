import type { GitForgeContext } from '../server/git-port.js';
import { GitForgeError } from '../server/git-port.js';

export type GitHubFetch = typeof globalThis.fetch;
/** No redirects, driver text or response headers can carry an installation token out of this adapter. */
export async function githubBytes(fetcher: GitHubFetch, url: string, init: RequestInit, maxBytes = 16 * 1024 * 1024): Promise<Uint8Array> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new GitForgeError('unavailable'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new GitForgeError(response.status === 404 ? 'missing' : [409, 422].includes(response.status) ? 'conflict' : 'unavailable');
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw new GitForgeError('unavailable');
  }
  if (!response.body) throw new GitForgeError('unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.length;
      if (count > maxBytes) { await reader.cancel(); throw new GitForgeError('unavailable'); }
      chunks.push(value);
    }
  } catch { throw new GitForgeError('unavailable'); }
  return Buffer.concat(chunks);
}
export function githubApi(fetcher: GitHubFetch) {
  return async (context: GitForgeContext, path: string, body?: unknown): Promise<any> => {
    const bytes = await githubBytes(fetcher, `https://api.github.com/repos/${context.locator}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${context.token}`, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    try { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
    catch { throw new GitForgeError('unavailable'); }
  };
}
