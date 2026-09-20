import { describe, expect, it } from 'vitest';

import { MuseEnrollmentProvider } from '../../src/enrollment/muse.js';

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
});
