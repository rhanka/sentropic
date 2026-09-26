import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeEnrollmentProvider } from '../../src/enrollment/claude-code.js';

const ACCESS = 'FAKE_CLAUDE_ACCESS_CANARY_742';
const REFRESH = 'FAKE_CLAUDE_REFRESH_CANARY_391';
const CODE = 'FAKE_CLAUDE_CODE_CANARY_608';
const VERSION = 'claude-code-oauth-2.1.80-v1';
const NOW = Date.parse('2026-09-26T12:00:00Z');
const start = { configRef: 'claude-code', mode: 'cli' as const, redirectUri: '', ownerScope: 'owner-a' };
const document = (extra = {}) => ({ accessToken: ACCESS, refreshToken: REFRESH,
  expiresAt: NOW + 3600_000, scopes: ['user:inference'], ...extra });
const grant = (extra = {}) => ({ access_token: ACCESS, refresh_token: REFRESH,
  expires_in: 3600, scope: 'user:inference', ...extra });
const response = (body = grant(), status = 200) => new Response(JSON.stringify(body), { status });
const setup = (fetchFn = vi.fn(async () => response())) => ({ fetchFn,
  provider: new ClaudeCodeEnrollmentProvider({ fetchFn, nowFn: () => NOW }) });
const returnedCode = (session: { kind: string; url?: string }) =>
  `${CODE}#${new URL(session.url!).searchParams.get('state')}`;
async function safeFailure(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  for (const secret of [ACCESS, REFRESH, CODE]) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  }
  return error;
}
afterEach(() => vi.useRealTimers());

describe('Claude renewable enrollment', () => {
  it('uses the A2 browser profile, PKCE and one JSON exchange with offline resolution', async () => {
    const { provider, fetchFn } = setup();
    const session = await provider.start(start);
    expect(session.kind).toBe('authorization-url');
    if (session.kind !== 'authorization-url') throw new Error('Wrong session');
    const url = new URL(session.url);
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ code: 'true', response_type: 'code',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', code_challenge_method: 'S256',
      redirect_uri: 'https://platform.claude.com/oauth/code/callback',
      scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload' });
    expect(Date.parse(session.expiresAt) - NOW).toBe(15 * 60_000);
    const credential = await provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) });
    expect(credential).toMatchObject({ accessToken: ACCESS, refreshToken: REFRESH,
      expiresAt: new Date(NOW + 3600_000).toISOString(), authClientConfigVersion: VERSION });
    expect(credential.accountId).toMatch(/^acct_claude_[\w-]{22}$/);
    const [endpoint, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe('https://platform.claude.com/v1/oauth/token');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' } });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: CODE,
      state: url.searchParams.get('state'), redirect_uri: url.searchParams.get('redirect_uri') });
    expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(Object.keys(body).sort()).toEqual(['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri', 'state']);
    expect(await provider.resolve(credential)).toMatchObject({ billing_type: 'seat', scopes: ['user:inference'] });
    await safeFailure(provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('imports full=%s renewable JSON offline and discards unknown fields', async (full) => {
    const { provider, fetchFn } = setup();
    const inner = document({ expiresAt: NOW - 1, unknown: CODE, accountEmail: ACCESS });
    const credential = await provider.importCredential(JSON.stringify(full ? { claudeAiOauth: inner, otherStore: CODE } : inner));
    expect(credential.expiresAt).toBe(new Date(NOW - 1).toISOString());
    expect(credential.authClientConfigVersion).toBe(VERSION);
    expect(credential).not.toHaveProperty('accountEmail');
    expect(JSON.stringify(await provider.resolve(credential))).not.toMatch(/CANARY/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([null, [], 'bare-token', {}, { accessToken: '' }, { accessToken: `${ACCESS}\r\n` },
    { refreshToken: undefined, expiresAt: NOW - 1 }, { refreshToken: '' }, { refreshToken: `${REFRESH}\n` },
    { expiresAt: '2026-01-01' }, { expiresAt: 0 }, { expiresAt: -1 }, { expiresAt: 1e99 },
    { scopes: [] }, { scopes: ['user:profile'] }, { scopes: ['user:inference', CODE] }])(
    'refuses invalid renewable fields without secret errors (%j)', async (extra) => {
      const { provider, fetchFn } = setup();
      const value = extra && !Array.isArray(extra) && typeof extra === 'object'
        ? (Object.keys(extra).length ? document(extra) : {}) : extra;
      await safeFailure(provider.importCredential(JSON.stringify(value)));
      expect(fetchFn).not.toHaveBeenCalled();
    });

  it('enforces JSON UTF-8 size and syntax without echoing input', async () => {
    const { provider } = setup();
    await safeFailure(provider.importCredential(ACCESS));
    await safeFailure(provider.importCredential(JSON.stringify(document({ padding: 'é'.repeat(33_000) }))));
    await safeFailure(provider.importCredential(JSON.stringify({ claudeAiOauth: [] })));
  });
});
