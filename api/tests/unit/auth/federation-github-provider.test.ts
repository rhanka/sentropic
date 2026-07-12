import { describe, expect, it, vi } from 'vitest';

import { fetchGithubIdentity } from '../../../src/services/auth/federation/github-provider';

/**
 * BR-39e Lot 2 — GitHub identity derivation from the two REST endpoints, tested with a FAKE `fetch`
 * (never a real GitHub call). Proves the subject is the numeric account id (D6/D13) and the email is
 * the PRIMARY row's `verified` flag — the input the resolver uses to decide login vs email challenge.
 */

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({ json: async () => body, ok, status }) as unknown as Response;

const SECRET_TOKEN = 'gho_SECRET-github-access-token-must-never-leak';

const makeFetch = (
  user: unknown,
  emails: unknown,
  opts: { userOk?: boolean; emailsOk?: boolean } = {},
): ReturnType<typeof vi.fn> =>
  vi.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.endsWith('/user')) return jsonResponse(user, opts.userOk ?? true, opts.userOk === false ? 401 : 200);
    if (href.endsWith('/user/emails')) {
      return jsonResponse(emails, opts.emailsOk ?? true, opts.emailsOk === false ? 403 : 200);
    }
    throw new Error(`unexpected fetch to ${href}`);
  });

describe('fetchGithubIdentity (BR-39e Lot 2)', () => {
  it('derives {subject=numeric id, primary verified email, emailVerified:true}', async () => {
    const fetchImpl = makeFetch({ id: 4242, login: 'octocat' }, [
      { email: 'secondary@example.com', primary: false, verified: true, visibility: null },
      { email: 'octocat@example.com', primary: true, verified: true, visibility: 'public' },
    ]);

    const identity = await fetchGithubIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN);

    expect(identity).toEqual({ email: 'octocat@example.com', emailVerified: true, subject: '4242' });
    // The access token is sent only as the Bearer header on GitHub calls, never returned.
    expect(JSON.stringify(identity)).not.toContain(SECRET_TOKEN);
    const [, init] = fetchImpl.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(init.headers['User-Agent']).toBeTruthy();
  });

  it('marks emailVerified:false when the primary email is unverified (→ email challenge, D9)', async () => {
    const fetchImpl = makeFetch({ id: 7, login: 'u' }, [
      { email: 'priv@example.com', primary: true, verified: false, visibility: null },
    ]);
    const identity = await fetchGithubIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN);
    expect(identity).toEqual({ email: 'priv@example.com', emailVerified: false, subject: '7' });
  });

  it('returns {email:null, emailVerified:false} when GitHub exposes no primary email (private, D9)', async () => {
    const fetchImpl = makeFetch({ id: 9, login: 'ghost' }, []);
    const identity = await fetchGithubIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN);
    expect(identity).toEqual({ email: null, emailVerified: false, subject: '9' });
  });

  it('throws when the /user response has no numeric id', async () => {
    const fetchImpl = makeFetch({ login: 'no-id' }, []);
    await expect(fetchGithubIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN)).rejects.toThrow(
      /numeric account id/,
    );
  });

  it('throws when the /user request is not ok', async () => {
    const fetchImpl = makeFetch({ id: 1 }, [], { userOk: false });
    await expect(fetchGithubIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN)).rejects.toThrow(
      /\/user request failed/,
    );
  });

  it('throws when the /user/emails request is not ok', async () => {
    const fetchImpl = makeFetch({ id: 1 }, [], { emailsOk: false });
    await expect(fetchGithubIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN)).rejects.toThrow(
      /\/user\/emails request failed/,
    );
  });
});
