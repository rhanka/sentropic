import { describe, expect, it } from 'vitest';

import type { EnrollmentProvider } from '../../src/enrollment/contracts.js';
import { MuseEnrollmentProvider } from '../../src/enrollment/muse.js';
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
});
