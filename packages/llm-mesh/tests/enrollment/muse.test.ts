import { describe, expect, it } from 'vitest';

import {
  buildMuseDirectAuthPayload,
  MuseEnrollmentProvider,
} from '../../src/enrollment/muse.js';

const AUTH_FILE = JSON.stringify({
  schema_version: 1,
  providers: {
    meta: {
      access_token: 'muse-test-access-token',
      api_key: 'muse-test-api-key',
      api_base_url: 'https://muse.test',
      mechanism: 'login',
      obtained_via: 'browser',
      user_email: 'owner@example.test',
      user_full_name: 'Test Owner',
    },
  },
});

const startInput = {
  configRef: 'default',
  mode: 'cli' as const,
  redirectUri: 'http://127.0.0.1',
  ownerScope: 'tenant-1:user-1',
};

const providerWithFile = (content: string) => new MuseEnrollmentProvider({
  readAuthFile: async () => content,
});

describe('MuseEnrollmentProvider', () => {
  it('starts a local-import session bound to the CLI auth file', async () => {
    const provider = providerWithFile(AUTH_FILE);

    const session = await provider.start(startInput);

    expect(session.kind).toBe('local-import');
    if (session.kind === 'local-import') {
      expect(session.enrollmentId).toMatch(/^enr_muse_/);
      expect(session.source).toBe('muse-cli-auth-file');
    }
  });

  it('completes by mapping the meta providers entry to a PreparedCredential', async () => {
    const provider = providerWithFile(AUTH_FILE);
    const session = await provider.start(startInput);

    const credential = await provider.complete({
      enrollmentId: session.enrollmentId,
      code: 'unused-for-import',
    });

    expect(credential.accountId).toMatch(/^acct_muse_/);
    expect(credential.accessToken).toBe('muse-test-access-token');
    expect(credential.accountEmail).toBe('owner@example.test');
    expect(credential.authClientConfigVersion).toBe('1');
    expect(new Date(credential.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('produces a stable account id for the same login across imports', async () => {
    const provider = providerWithFile(AUTH_FILE);
    const first = await provider.start(startInput);
    const second = await provider.start(startInput);

    const [a, b] = await Promise.all([
      provider.complete({ enrollmentId: first.enrollmentId, code: '' }),
      provider.complete({ enrollmentId: second.enrollmentId, code: '' }),
    ]);

    expect(a.accountId).toBe(b.accountId);
  });

  it('falls back to api_key when access_token is absent', async () => {
    const withoutAccessToken = JSON.stringify({
      schema_version: 1,
      providers: { meta: { api_key: 'only-api-key', user_email: 'owner@example.test' } },
    });
    const provider = providerWithFile(withoutAccessToken);
    const session = await provider.start(startInput);

    const credential = await provider.complete({
      enrollmentId: session.enrollmentId,
      code: '',
    });

    expect(credential.accessToken).toBe('only-api-key');
  });

  it('rejects a missing meta provider without leaking file content', async () => {
    const provider = providerWithFile(JSON.stringify({ schema_version: 1, providers: {} }));
    const session = await provider.start(startInput);

    const completion = provider.complete({ enrollmentId: session.enrollmentId, code: '' });
    await expect(completion).rejects.toThrow('meta');
    await expect(completion).rejects.not.toThrow('muse-test-access-token');
  });

  it('rejects malformed auth files without leaking content', async () => {
    const provider = providerWithFile('{not-json: muse-test-access-token');
    const session = await provider.start(startInput);

    const completion = provider.complete({ enrollmentId: session.enrollmentId, code: '' });
    await expect(completion).rejects.toThrow();
    await expect(completion).rejects.not.toThrow('muse-test-access-token');
  });

  it('refuses completion after cancel', async () => {
    const provider = providerWithFile(AUTH_FILE);
    const session = await provider.start(startInput);
    await provider.cancel(session.enrollmentId);

    await expect(
      provider.complete({ enrollmentId: session.enrollmentId, code: '' }),
    ).rejects.toThrow('cancelled');
  });

  it('refreshes by re-reading the CLI auth file', async () => {
    let content = AUTH_FILE;
    const provider = new MuseEnrollmentProvider({
      readAuthFile: async () => content,
    });
    const session = await provider.start(startInput);
    const credential = await provider.complete({
      enrollmentId: session.enrollmentId,
      code: '',
    });

    content = AUTH_FILE.replace('muse-test-access-token', 'muse-rotated-token');
    const refreshed = await provider.refresh({
      accountId: credential.accountId,
      refreshToken: undefined,
      credentialVersion: credential.authClientConfigVersion,
    });

    expect(refreshed.accountId).toBe(credential.accountId);
    expect(refreshed.accessToken).toBe('muse-rotated-token');
  });

  it('resolves credential metadata to the muse provider', async () => {
    const provider = providerWithFile(AUTH_FILE);
    const session = await provider.start(startInput);
    const credential = await provider.complete({
      enrollmentId: session.enrollmentId,
      code: '',
    });

    const metadata = await provider.resolve(credential);

    expect(metadata).toMatchObject({ provider: 'muse', accountId: credential.accountId });
  });

  it('imports a direct-billed MUSE_API_KEY as a stable credential', async () => {
    const provider = providerWithFile(AUTH_FILE);

    const first = await provider.importDirectApiKey('  muse-direct-key  ');
    const second = await provider.importDirectApiKey('muse-direct-key');

    expect(first.accountId).toMatch(/^acct_muse_/);
    expect(first.accountId).toBe(second.accountId);
    expect(first.accessToken).toBe('muse-direct-key');
    expect(new Date(first.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps direct-key accounts distinct from CLI-login accounts', async () => {
    // No email in the CLI store: the login account id derives from the raw
    // token, so importing that same string as a direct key must still land
    // on a different account (billing paths must never merge).
    const withoutEmail = JSON.stringify({
      schema_version: 1,
      providers: { meta: { access_token: 'muse-test-access-token' } },
    });
    const provider = providerWithFile(withoutEmail);
    const session = await provider.start(startInput);
    const loginCredential = await provider.complete({
      enrollmentId: session.enrollmentId,
      code: '',
    });

    const directCredential = await provider.importDirectApiKey('muse-test-access-token');

    expect(loginCredential.accountId).toMatch(/^acct_muse_/);
    expect(directCredential.accountId).not.toBe(loginCredential.accountId);
  });

  it('rejects a blank direct key without echoing it', async () => {
    const provider = providerWithFile(AUTH_FILE);

    await expect(provider.importDirectApiKey('   ')).rejects.toThrow(/direct.*api key/i);
  });

  it('builds the Meta direct auth payload from a key', () => {
    expect(buildMuseDirectAuthPayload('muse-direct-key')).toEqual({
      auth_type: 'api_key',
      user_api_key: 'muse-direct-key',
    });
  });

  it('refuses to build the Meta direct auth payload from a blank key', () => {
    expect(() => buildMuseDirectAuthPayload('  ')).toThrow(/direct.*api key/i);
  });
});

describe('MuseCodeEnrollmentProvider native device flow (S5)', () => {
  const startInputNative = {
    configRef: 'default',
    mode: 'cli' as const,
    redirectUri: 'http://127.0.0.1',
    ownerScope: 'tenant-1:user-1',
  };

  const jsonResponse = (payload: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });

  const deviceGrant = { device_code: 'dev-1', user_code: 'USER-1', verification_uri_complete: 'https://accountscenter.meta.com/muse_code/approve?x=1', expires_in: 900, interval: 0 };
  const tokenGrant = { access_token: 'dca-1', refresh_token: 'ref-1', expires_in: 3600 };
  const minted = { api_key: 'minted-key-1', user_email: 'native@example.test', is_subs_active: true };

  const decodeBody = (raw: unknown): unknown => {
    if (typeof raw !== 'string' || !raw) return undefined;
    try { return JSON.parse(raw); } catch { /* not JSON */ }
    // Live-probed 2026-09-21: Meta OIDC device endpoints take
    // application/x-www-form-urlencoded (JSON bodies get a 404).
    try { return Object.fromEntries(new URLSearchParams(raw)); } catch { return raw; }
  };
  const fetchFor = (routes: Array<{ match: (url: string, body: unknown) => boolean; respond: () => unknown }>) => {
    const calls: Array<{ url: string; body: unknown; contentType: string }> = [];
    const fetchFn = (async (url: unknown, init?: { body?: unknown; headers?: unknown }) => {
      const u = String(url);
      const body = decodeBody(init?.body);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: u, body, contentType: String(headers['content-type'] ?? '') });
      const route = routes.find((r) => r.match(u, body));
      if (!route) throw new Error(`unexpected fetch: ${u}`);
      return route.respond();
    }) as typeof fetch;
    return { fetchFn, calls };
  };

  it('starts a device-code session against the measured Meta endpoints', async () => {
    const { fetchFn, calls } = fetchFor([
      { match: (u) => u.includes('/oidc/device/authorization/'), respond: () => jsonResponse(deviceGrant) },
    ]);
    const { MuseCodeEnrollmentProvider } = await import('../../src/enrollment/muse-code.js');
    const provider = new MuseCodeEnrollmentProvider({ fetchFn });

    const session = await provider.start(startInputNative);

    expect(session.kind).toBe('device-code');
    if (session.kind === 'device-code') {
      expect(session.userCode).toBe('USER-1');
      expect(session.verificationUrl).toContain('accountscenter.meta.com/muse_code/');
    }
    expect(calls[0]?.url).toContain('auth.meta.com/oidc/device/authorization/');
    expect(calls[0]?.body).toMatchObject({ client_id: expect.any(String) });
    expect(calls[0]?.contentType).toContain('application/x-www-form-urlencoded');
  });

  it('completes by polling, minting a key, and persisting the refresh token', async () => {
    const { fetchFn, calls } = fetchFor([
      { match: (u) => u.includes('/oidc/device/authorization/'), respond: () => jsonResponse(deviceGrant) },
      { match: (u, b) => u.includes('/oidc/device/token/') && (b as {grant_type?: string})?.grant_type !== 'refresh_token', respond: () => jsonResponse(tokenGrant) },
      { match: (u) => u.includes('/muse-code/key'), respond: () => jsonResponse(minted) },
    ]);
    const { MuseCodeEnrollmentProvider } = await import('../../src/enrollment/muse-code.js');
    const provider = new MuseCodeEnrollmentProvider({ fetchFn });

    const session = await provider.start(startInputNative);
    const res = await provider.pollForCompletion(session.enrollmentId, 5);
    const credential = res.credential!;

    expect(credential.accountId).toMatch(/^acct_muse_/);
    expect(credential.accessToken).toBe('minted-key-1');
    expect(credential.refreshToken).toBe('ref-1');
    expect(credential.accountEmail).toBe('native@example.test');
    const keyCall = calls.find((c) => c.url.includes('/muse-code/key'));
    expect(keyCall?.body).toMatchObject({ dca_token: 'dca-1' });
    const tokenCall = calls.find((c) => c.url.includes('/oidc/device/token/'));
    expect(tokenCall?.contentType).toContain('application/x-www-form-urlencoded');
    expect(tokenCall?.body).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: expect.any(String),
      client_id: expect.any(String),
    });
  });

  it('fails up on access_denied without minting', async () => {
    const { fetchFn } = fetchFor([
      { match: (u) => u.includes('/oidc/device/authorization/'), respond: () => jsonResponse(deviceGrant) },
      { match: (u) => u.includes('/oidc/device/token/'), respond: () => jsonResponse({ error: 'access_denied' }, 400) },
    ]);
    const { MuseCodeEnrollmentProvider } = await import('../../src/enrollment/muse-code.js');
    const provider = new MuseCodeEnrollmentProvider({ fetchFn });

    const session = await provider.start(startInputNative);
    await expect(provider.pollForCompletion(session.enrollmentId, 2)).rejects.toThrow(/denied/i);
  });

  it('refreshes via the refresh_token grant and re-mints', async () => {
    const rotated = { api_key: 'minted-key-2', user_email: 'native@example.test' };
    let tokenCalls = 0;
    const { fetchFn } = fetchFor([
      { match: (u) => u.includes('/oidc/device/authorization/'), respond: () => jsonResponse(deviceGrant) },
      {
        match: (u, b) => u.includes('/oidc/device/token/') && (b as {grant_type?: string})?.grant_type !== 'refresh_token',
        respond: () => jsonResponse(tokenGrant),
      },
      { match: (u) => u.includes('/muse-code/key') && tokenCalls++ === 0, respond: () => jsonResponse(minted) },
      { match: (u) => u.includes('/muse-code/key'), respond: () => jsonResponse(rotated) },
      {
        match: (u, b) => u.includes('/oidc/device/token/') && (b as {grant_type?: string})?.grant_type === 'refresh_token',
        respond: () => jsonResponse({ access_token: 'dca-2', refresh_token: 'ref-2', expires_in: 3600 }),
      },
    ]);
    const { MuseCodeEnrollmentProvider } = await import('../../src/enrollment/muse-code.js');
    const provider = new MuseCodeEnrollmentProvider({ fetchFn });

    const session = await provider.start(startInputNative);
    const res = await provider.pollForCompletion(session.enrollmentId, 5);
    const credential = res.credential!;
    const refreshed = await provider.refresh({
      accountId: credential.accountId,
      refreshToken: credential.refreshToken,
      credentialVersion: credential.authClientConfigVersion,
    });

    expect(refreshed.accountId).toBe(credential.accountId);
    expect(refreshed.accessToken).toBe('minted-key-2');
    expect(refreshed.refreshToken).toBe('ref-2');
  });

  it('sends the OIDC calls form-encoded (JSON bodies get a live 404)', async () => {
    const quickGrant = { ...deviceGrant, interval: 1 };
    const { fetchFn, calls } = fetchFor([
      { match: (u) => u.includes('/oidc/device/authorization/'), respond: () => jsonResponse(quickGrant) },
      { match: (u) => u.includes('/oidc/device/token/'), respond: () => jsonResponse({ error: 'authorization_pending' }, 400) },
    ]);
    const { MuseCodeEnrollmentProvider } = await import('../../src/enrollment/muse-code.js');
    const provider = new MuseCodeEnrollmentProvider({ fetchFn });

    const session = await provider.start(startInputNative);
    await expect(provider.pollForCompletion(session.enrollmentId, 1)).rejects.toThrow(/did not complete after/);

    const authCall = calls.find((c) => c.url.includes('/oidc/device/authorization/'));
    const tokenCall = calls.find((c) => c.url.includes('/oidc/device/token/'));
    expect(authCall?.contentType).toContain('application/x-www-form-urlencoded');
    expect(tokenCall?.contentType).toContain('application/x-www-form-urlencoded');
  });
});
