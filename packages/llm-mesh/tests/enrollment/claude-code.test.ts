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
  it.each(['complete', 'cancel'])('wipes the verifier after %s and never puts it in the authorization URL', async (action) => {
    const { provider } = setup();
    const session = await provider.start(start);
    if (session.kind !== 'authorization-url') throw new Error('Wrong session');
    const sessions = (provider as unknown as { sessions: Map<string, { verifier: string; state: string }> }).sessions;
    const retained = sessions.get(session.enrollmentId)!;
    expect(retained.verifier.length).toBeGreaterThan(30);
    expect(session.url).not.toContain(retained.verifier);
    expect(new URL(session.url!).searchParams.has('code_verifier')).toBe(false);
    if (action === 'complete') {
      await provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) });
    } else await provider.cancel(session.enrollmentId);
    expect(sessions.has(session.enrollmentId)).toBe(false);
    expect(retained.verifier).toBe('');
    expect(retained.state).toBe('');
  });

  it.each([65_535, 65_536, 65_537])('enforces the exact UTF-8 import boundary at %i bytes', async (bytes) => {
    const { provider, fetchFn } = setup();
    const base = JSON.stringify(document({ padding: 'é' }));
    const input = base + ' '.repeat(bytes - new TextEncoder().encode(base).length);
    expect(new TextEncoder().encode(input).length).toBe(bytes);
    if (bytes <= 65_536) await expect(provider.importCredential(input)).resolves.toMatchObject({ accessToken: ACCESS });
    else await safeFailure(provider.importCredential(input));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', ['user:inference']])('uses prior scopes only for omitted refresh scope (%j)', async (scope) => {
    const { provider } = setup(vi.fn(async () => response(grant({ scope }))));
    const pending = provider.refresh({ accountId: 'opaque', refreshToken: REFRESH,
      credentialVersion: VERSION, grantedScopes: ['user:inference'] });
    if (scope === undefined) {
      expect((await provider.resolve(await pending)).scopes).toEqual(['user:inference']);
    } else await safeFailure(pending);
    const session = await provider.start(start);
    await safeFailure(provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) }));
  });

  it('uses bundled refresh without the host resolver and rejects old/unknown references offline', async () => {
    const resolveConfig = vi.fn(async () => ({}));
    const fetchFn = vi.fn(async () => response());
    const provider = new ClaudeCodeEnrollmentProvider({ configResolver: { resolveConfig }, fetchFn, nowFn: () => NOW });
    const credential = await provider.importCredential(JSON.stringify(document()));
    expect(resolveConfig).toHaveBeenCalledWith('claude-code');
    resolveConfig.mockClear();
    await provider.refresh({ accountId: credential.accountId, refreshToken: REFRESH, credentialVersion: VERSION });
    expect(resolveConfig).not.toHaveBeenCalled();
    fetchFn.mockClear();
    for (const credentialVersion of ['', 'v1.0.0', 'unknown']) {
      await safeFailure(provider.refresh({ accountId: 'opaque', refreshToken: REFRESH, credentialVersion }));
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([null, [], { id: 'incomplete' }, 'throw'])(
    'fails closed on nonempty invalid or throwing resolver (%j)', async (value) => {
      const fetchFn = vi.fn();
      const provider = new ClaudeCodeEnrollmentProvider({ fetchFn, configResolver: {
        async resolveConfig() { if (value === 'throw') throw new Error(CODE); return value as any; },
      } });
      await safeFailure(provider.start(start));
      await safeFailure(provider.importCredential(JSON.stringify(document())));
      expect(fetchFn).not.toHaveBeenCalled();
    });

  it('imports with a custom profile, snapshots it and restores its exact version through a new provider', async () => {
    const profile = { id: 'qualified-profile-v2', authorizationUrl: 'https://auth.example.test/authorize',
      tokenUrl: 'https://auth.example.test/token', redirectUri: 'https://auth.example.test/callback',
      clientId: 'public-client-id', source: 'https://source.example.test/v2',
      authorizationScopes: ['user:inference'], refreshScopes: ['user:inference'], requiredScopes: ['user:inference'] };
    const original = structuredClone(profile);
    const resolveConfig = vi.fn(async () => profile);
    const fetchFn = vi.fn(async () => response());
    const options = { configResolver: { resolveConfig }, fetchFn, nowFn: () => NOW };
    const provider = new ClaudeCodeEnrollmentProvider(options);
    const imported = await provider.importCredential(JSON.stringify(document()));
    expect(imported.authClientConfigVersion).toBe(original.id);
    expect((await provider.resolve(imported)).scopes).toEqual(original.requiredScopes);
    expect(resolveConfig).toHaveBeenLastCalledWith('claude-code');
    expect(fetchFn).not.toHaveBeenCalled();
    const session = await provider.start({ ...start, configRef: 'host-profile' });
    profile.tokenUrl = 'https://changed.example.test/token';
    profile.requiredScopes.push('user:profile');
    const credential = await provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) });
    expect(fetchFn.mock.calls[0][0]).toBe(original.tokenUrl);
    expect(credential.authClientConfigVersion).toBe(original.id);
    Object.assign(profile, original);
    const restored = new ClaudeCodeEnrollmentProvider(options);
    await restored.refresh({ accountId: credential.accountId, refreshToken: REFRESH, credentialVersion: original.id });
    expect(resolveConfig).toHaveBeenLastCalledWith(original.id);
    fetchFn.mockClear();
    profile.id = 'wrong-version';
    await safeFailure(restored.refresh({ accountId: 'opaque', refreshToken: REFRESH, credentialVersion: original.id }));
    profile.id = VERSION;
    await safeFailure(restored.start(start));
    profile.id = original.id;
    profile.tokenUrl = 'http://unsafe.example.test/token';
    await safeFailure(restored.start(start));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requires enrollment refresh material and rejects reflected OAuth error codes', async () => {
    const body = grant();
    delete (body as Partial<typeof body>).refresh_token;
    const { provider, fetchFn } = setup(vi.fn(async () => response(body)));
    const session = await provider.start(start);
    await safeFailure(provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) }));
    fetchFn.mockResolvedValue(response({ error: CODE } as any, 401));
    const error = await safeFailure(provider.refresh({ accountId: 'opaque', refreshToken: REFRESH, credentialVersion: VERSION }));
    expect(String(error)).toContain('HTTP 401 oauth_error');
  });

  it.each(['missing', 'mismatch', 'extra', 'blank', 'expired', 'cancelled'])(
    'refuses %s manual return before exchange', async (mode) => {
      let now = NOW;
      const fetchFn = vi.fn(async () => response());
      const provider = new ClaudeCodeEnrollmentProvider({ fetchFn, nowFn: () => now });
      const session = await provider.start(start);
      let code = returnedCode(session);
      if (mode === 'missing') code = CODE;
      if (mode === 'mismatch') code = `${CODE}#wrong`;
      if (mode === 'extra') code += '#extra';
      if (mode === 'blank') code = code.replace(CODE, '');
      if (mode === 'expired') now += 15 * 60_000;
      if (mode === 'cancelled') await provider.cancel(session.enrollmentId);
      await safeFailure(provider.complete({ enrollmentId: session.enrollmentId, code }));
      expect(fetchFn).not.toHaveBeenCalled();
    });

  it.each(['success', 'cancel', 'expiry', 'timeout'])('locks concurrent completion through %s', async (mode) => {
    vi.useFakeTimers();
    let now = NOW;
    let finish!: (result: Response) => void;
    const fetchFn = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const provider = new ClaudeCodeEnrollmentProvider({ fetchFn, nowFn: () => now });
    const session = await provider.start(start);
    const input = { enrollmentId: session.enrollmentId, code: returnedCode(session) };
    const pending = provider.complete(input);
    const settled = pending.then((value) => value, (error) => error);
    await safeFailure(provider.complete(input));
    if (mode === 'cancel') await provider.cancel(session.enrollmentId);
    if (mode === 'expiry') now += 15 * 60_000;
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
    finish(response());
    const result = await settled;
    if (mode === 'success') expect(result.accountId).toMatch(/^acct_claude_/);
    else expect(result).toBeInstanceOf(Error);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await safeFailure(provider.complete(input));
  });

  it('sweeps idle sessions at TTL and refuses redirects/blank owners', async () => {
    vi.useFakeTimers();
    const { provider, fetchFn } = setup();
    await safeFailure(provider.start({ ...start, ownerScope: ' ' }));
    await safeFailure(provider.start({ ...start, redirectUri: 'https://evil.invalid' }));
    const session = await provider.start(start);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await safeFailure(provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) }));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ access_token: '' }, { access_token: `${ACCESS}\n` }, { refresh_token: '' },
    { refresh_token: null }, { expires_in: 0 }, { expires_in: -1 }, { expires_in: '3600' },
    { expires_in: 1e99 }, { scope: 'user:profile' }, { scope: null }])('refuses malformed token grants (%j)', async (extra) => {
      const { provider } = setup(vi.fn(async () => response(grant(extra))));
      await safeFailure(provider.refresh({ accountId: 'opaque', refreshToken: REFRESH, credentialVersion: VERSION }));
    });

  it.each([true, false])('refreshes JSON with rotated token present=%s', async (rotates) => {
    const body = grant();
    if (!rotates) delete (body as Partial<typeof body>).refresh_token;
    else body.refresh_token = 'FAKE_ROTATED_CANARY';
    const { provider, fetchFn } = setup(vi.fn(async () => response(body)));
    const credential = await provider.refresh({ accountId: 'opaque', refreshToken: REFRESH, credentialVersion: VERSION });
    expect(credential.refreshToken).toBe(rotates ? 'FAKE_ROTATED_CANARY' : REFRESH);
    expect(credential.accountId).toBe('opaque');
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ grant_type: 'refresh_token', refresh_token: REFRESH,
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      scope: 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload' });
  });

  it.each(['body', 'network', 'json'])('sanitizes %s failure without retry', async (kind) => {
    const fetchFn = vi.fn(async () => {
      if (kind === 'network') throw new Error(`${ACCESS} ${REFRESH} ${CODE}`);
      if (kind === 'json') return new Response(`${ACCESS} ${CODE}`, { status: 500 });
      return response({ error: 'invalid_grant', error_description: `${ACCESS} ${REFRESH} ${CODE}` } as any, 400);
    });
    const { provider } = setup(fetchFn);
    const session = await provider.start(start);
    const error = await safeFailure(provider.complete({ enrollmentId: session.enrollmentId, code: returnedCode(session) }));
    if (kind === 'body') expect(String(error)).toContain('HTTP 400 invalid_grant');
    if (kind === 'json') expect(String(error)).toContain('HTTP 500 invalid_response');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

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
