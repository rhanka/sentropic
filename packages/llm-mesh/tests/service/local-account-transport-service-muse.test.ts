import { describe, expect, it } from 'vitest';

import type { EnrollmentProvider } from '../../src/enrollment/contracts.js';
import { MuseEnrollmentProvider } from '../../src/enrollment/muse.js';
import { MuseCodeEnrollmentProvider } from '../../src/enrollment/muse-code.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';

const AUTH_FILE = JSON.stringify({
  schema_version: 1,
  providers: {
    meta: {
      access_token: 'muse-roundtrip-access',
      api_key: 'muse-roundtrip-key',
      api_base_url: 'https://muse.test',
      mechanism: 'login',
      obtained_via: 'browser',
      user_email: 'owner@example.test',
      user_full_name: 'Test Owner',
    },
  },
});

const OWNER_SCOPE = 'tenant-1:user-1';

const setup = () => {
  const keyring = new InMemoryKeyring();
  const providers = new Map<string, EnrollmentProvider>([
    ['muse', new MuseEnrollmentProvider({ readAuthFile: async () => AUTH_FILE })],
  ]);
  const configResolver = { async resolveConfig() { return {}; } };
  const service = new LocalAccountTransportService(keyring, providers, configResolver);
  return { keyring, service };
};

describe('LocalAccountTransportService muse import round-trip', () => {
  it('enrolls, completes, persists, and acquires the imported CLI account', async () => {
    const { keyring, service } = setup();

    const session = await service.enroll('muse', {
      configRef: 'default',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1',
      ownerScope: OWNER_SCOPE,
    });
    expect(session.kind).toBe('local-import');

    const completion = await service.completeMuseImport(
      session.enrollmentId,
      '',
      OWNER_SCOPE,
    );
    expect(completion.accountId).toMatch(/^acct_muse_/);
    expect(completion.label).toContain('Muse');

    const acquisition = await service.acquire({
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      ownerScopeRef: OWNER_SCOPE,
    });
    expect(acquisition.material).toMatchObject({
      accountId: completion.accountId,
      accessToken: 'muse-roundtrip-access',
    });

    // Keyring holds the generic envelope + public + owner records.
    const prefix = `sentropic-llm-mesh:${completion.accountId}`;
    const envelope = await keyring.getSecret(`${prefix}:envelope`);
    expect(envelope).toContain('muse-roundtrip-access');
    const publicRecord = await keyring.getSecret(`${prefix}:public`);
    expect(publicRecord).toContain('muse');
    const owner = await keyring.getSecret(`${prefix}:owner`);
    expect(owner).toContain(OWNER_SCOPE);
  });

  it('refreshes an expired credential on acquire by re-reading the CLI store', async () => {
    let content = AUTH_FILE;
    const keyring = new InMemoryKeyring();
    const providers = new Map<string, EnrollmentProvider>([
      ['muse', new MuseEnrollmentProvider({ readAuthFile: async () => content })],
    ]);
    const configResolver = { async resolveConfig() { return {}; } };
    const service = new LocalAccountTransportService(keyring, providers, configResolver);

    const session = await service.enroll('muse', {
      configRef: 'default',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1',
      ownerScope: OWNER_SCOPE,
    });
    const completion = await service.completeMuseImport(
      session.enrollmentId,
      '',
      OWNER_SCOPE,
    );

    // CLI rotates its store (e.g. background refresh); the mesh credential
    // is expired by the time the next acquire runs with a future clock.
    content = AUTH_FILE.replace('muse-roundtrip-access', 'muse-rotated-live');
    const acquisition = await service.acquire({
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      ownerScopeRef: OWNER_SCOPE,
      now: Date.now() + 2 * 3600 * 1000,
    });

    expect(acquisition.material.accountId).toBe(completion.accountId);
    expect(acquisition.material.accessToken).toBe('muse-rotated-live');

    const envelope = await keyring.getSecret(
      `sentropic-llm-mesh:${completion.accountId}:envelope`,
    );
    expect(envelope).toContain('muse-rotated-live');
  });

  it('refuses completion for a foreign owner scope', async () => {
    const { service } = setup();
    const session = await service.enroll('muse', {
      configRef: 'default',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1',
      ownerScope: OWNER_SCOPE,
    });

    await expect(
      service.completeMuseImport(session.enrollmentId, '', '  '),
    ).rejects.toThrow('ownerScope');
  });

  it('restores the imported account in a fresh runtime service', async () => {
    const keyring = new InMemoryKeyring();
    const providers = new Map<string, EnrollmentProvider>([
      ['muse', new MuseEnrollmentProvider({ readAuthFile: async () => AUTH_FILE })],
    ]);
    const configResolver = { async resolveConfig() { return {}; } };
    const enrollmentService = new LocalAccountTransportService(
      keyring,
      providers,
      configResolver,
    );

    const session = await enrollmentService.enroll('muse', {
      configRef: 'default',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1',
      ownerScope: OWNER_SCOPE,
    });
    const completion = await enrollmentService.completeMuseImport(
      session.enrollmentId,
      '',
      OWNER_SCOPE,
    );

    const runtimeService = new LocalAccountTransportService(
      keyring,
      providers,
      configResolver,
      OWNER_SCOPE,
    );
    const acquisition = await runtimeService.acquire({
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      ownerScopeRef: OWNER_SCOPE,
    });
    expect(acquisition.material.accountId).toBe(completion.accountId);
  });

  it('enrolls a direct-billed MUSE_API_KEY account and acquires it', async () => {
    const { keyring, service } = setup();

    const completion = await service.completeMuseDirectImport(
      'muse-direct-key',
      OWNER_SCOPE,
    );
    expect(completion.accountId).toMatch(/^acct_muse_/);
    expect(completion.label).toContain('Muse');

    const acquisition = await service.acquire({
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      ownerScopeRef: OWNER_SCOPE,
    });
    expect(acquisition.material).toMatchObject({
      accountId: completion.accountId,
      accessToken: 'muse-direct-key',
    });

    // The public record carries the direct-billing marker but never the key.
    const publicRecord = await keyring.getSecret(
      `sentropic-llm-mesh:${completion.accountId}:public`,
    );
    expect(publicRecord).toContain('direct');
    expect(publicRecord).not.toContain('muse-direct-key');
  });

  it('re-imports of the same direct key converge on one account', async () => {
    const { service } = setup();

    const first = await service.completeMuseDirectImport('muse-direct-key', OWNER_SCOPE);
    const second = await service.completeMuseDirectImport('muse-direct-key', OWNER_SCOPE);

    expect(second.accountId).toBe(first.accountId);
  });

  it('refuses a direct import without an owner scope', async () => {
    const { service } = setup();

    await expect(
      service.completeMuseDirectImport('muse-direct-key', '  '),
    ).rejects.toThrow('ownerScope');
  });

  it('rejects a blank direct key without echoing it', async () => {
    const { service } = setup();

    await expect(service.completeMuseDirectImport('  ', OWNER_SCOPE)).rejects.toThrow(
      /direct.*api key/i,
    );
  });
});

describe('LocalAccountTransportService muse native device-flow round-trip (S5)', () => {
  const jsonResponse = (payload: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });

  const setupDevice = () => {
    const routes: Array<{ match: (url: string) => boolean; respond: () => unknown }> = [
      {
        match: (u) => u.includes('/oidc/device/authorization/'),
        respond: () => jsonResponse({ device_code: 'dev-1', user_code: 'USER-1', verification_uri_complete: 'https://accountscenter.meta.com/muse_code/a', expires_in: 900, interval: 0 }),
      },
      {
        match: (u) => u.includes('/oidc/device/token/'),
        respond: () => jsonResponse({ access_token: 'dca-1', refresh_token: 'ref-1', expires_in: 3600 }),
      },
      {
        match: (u) => u.includes('/muse-code/key'),
        respond: () => jsonResponse({ api_key: 'minted-svc-key', user_email: 'svc@example.test' }),
      },
    ];
    const fetchFn = (async (url: unknown) => {
      const route = routes.find((r) => r.match(String(url)));
      if (!route) throw new Error(`unexpected fetch: ${String(url)}`);
      return route.respond();
    }) as typeof fetch;
    const keyring = new InMemoryKeyring();
    const providers = new Map<string, EnrollmentProvider>([
      ['muse-code', new MuseCodeEnrollmentProvider({ fetchFn })],
    ]);
    const configResolver = { async resolveConfig() { return {}; } };
    const service = new LocalAccountTransportService(keyring, providers, configResolver);
    return { keyring, service };
  };

  it('enrolls via device flow, persists the refresh token, and acquires', async () => {
    const { keyring, service } = setupDevice();

    const session = await service.enroll('muse-code', {
      configRef: 'default',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1',
      ownerScope: OWNER_SCOPE,
    });
    expect(session.kind).toBe('device-code');

    const completion = await service.completeMuseDeviceImport(session.enrollmentId, OWNER_SCOPE, 5);
    expect(completion.accountId).toMatch(/^acct_muse_/);

    const acquisition = await service.acquire({
      targetProviderId: 'muse',
      transportProviderId: 'muse',
      ownerScopeRef: OWNER_SCOPE,
    });
    expect(acquisition.material).toMatchObject({
      accountId: completion.accountId,
      accessToken: 'minted-svc-key',
    });

    // Refresh token persisted in the sealed envelope; public record carries
    // the seat-billing marker and no secret.
    const envelope = await keyring.getSecret(`sentropic-llm-mesh:${completion.accountId}:envelope`);
    expect(envelope).toContain('ref-1');
    const publicRecord = await keyring.getSecret(`sentropic-llm-mesh:${completion.accountId}:public`);
    expect(publicRecord).toContain('seat');
    expect(publicRecord).not.toContain('minted-svc-key');
  });
});
