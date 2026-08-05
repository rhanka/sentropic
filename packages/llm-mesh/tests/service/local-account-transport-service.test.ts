import { describe, expect, it, vi } from 'vitest';
import { AccountTransportAcquireError } from '../../src/account-transports.js';
import type { EnrollmentProvider, PreparedCredential } from '../../src/enrollment/contracts.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';

describe('LocalAccountTransportService', () => {
  it('acquires an active account and refreshes atomically if expired', async () => {
    const keyring = new InMemoryKeyring();
    const mockProvider: EnrollmentProvider = {
      async start() {
        throw new Error('Not implemented');
      },
      async complete() {
        throw new Error('Not implemented');
      },
      async resolve() {
        return {};
      },
      async refresh(input): Promise<PreparedCredential> {
        expect(input.refreshToken).toBe('old-refresh-token'); // P0-7: explicit refreshToken passed
        return {
          accountId: input.accountId,
          accessToken: 'refreshed-access-token',
          refreshToken: 'refreshed-refresh-token',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          authClientConfigVersion: 'v1.0.0',
        };
      },
    };

    const providers = new Map<string, EnrollmentProvider>([['cloud-code', mockProvider]]);
    const configResolver = {
      async resolveConfig() {
        return {};
      },
    };

    const service = new LocalAccountTransportService(keyring, providers, configResolver);

    const pastExpiresAt = new Date(Date.now() - 1000).toISOString();
    service.registerAccount({
      accountId: 'acct_expired_1',
      targetProviderId: 'gemini',
      transportProviderId: 'cloud-code',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: pastExpiresAt,
      status: 'active',
      metadata: { cloudaicompanionProject: 'test-project' },
    });

    const acquisition = await service.acquire({
      targetProviderId: 'gemini',
      transportProviderId: 'cloud-code',
    });

    expect(acquisition.material.accessToken).toBe('refreshed-access-token');
    expect(acquisition.material.refreshToken).toBe('refreshed-refresh-token');

    // Verify atomic persistence to keyring
    const publicSecret = await keyring.getSecret('sentropic-llm-mesh:acct_expired_1:public');
    const envelopeSecret = await keyring.getSecret('sentropic-llm-mesh:acct_expired_1:envelope');
    expect(publicSecret).toContain('acct_expired_1');
    expect(envelopeSecret).toContain('refreshed-access-token');
  });

  it('deduplicates concurrent refresh requests via single-flight map (P0-5)', async () => {
    const keyring = new InMemoryKeyring();
    let refreshCalls = 0;

    const mockProvider: EnrollmentProvider = {
      async start() {
        throw new Error('Not implemented');
      },
      async complete() {
        throw new Error('Not implemented');
      },
      async resolve() {
        return {};
      },
      async refresh(input): Promise<PreparedCredential> {
        refreshCalls += 1;
        // Simulate network latency
        await new Promise((res) => setTimeout(res, 50));
        return {
          accountId: input.accountId,
          accessToken: 'single-flight-token',
          refreshToken: 'single-flight-refresh',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          authClientConfigVersion: 'v1.0.0',
        };
      },
    };

    const service = new LocalAccountTransportService(
      keyring,
      new Map([['cloud-code', mockProvider]]),
      { async resolveConfig() { return {}; } },
    );

    const pastExpiresAt = new Date(Date.now() - 1000).toISOString();
    service.registerAccount({
      accountId: 'acct_concurrent_1',
      targetProviderId: 'gemini',
      transportProviderId: 'cloud-code',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: pastExpiresAt,
      status: 'active',
      metadata: { cloudaicompanionProject: 'test-project' },
    });

    // Launch two parallel acquire calls
    const [acq1, acq2] = await Promise.all([
      service.acquire({ targetProviderId: 'gemini', transportProviderId: 'cloud-code' }),
      service.acquire({ targetProviderId: 'gemini', transportProviderId: 'cloud-code' }),
    ]);

    expect(refreshCalls).toBe(1); // Single flight: only 1 network refresh was issued!
    expect(acq1.material.accessToken).toBe('single-flight-token');
    expect(acq2.material.accessToken).toBe('single-flight-token');
  });

  it('marks reauth_required and throws AccountTransportAcquireError when refresh fails', async () => {
    const keyring = new InMemoryKeyring();
    const failingProvider: EnrollmentProvider = {
      async start() {
        throw new Error('Not implemented');
      },
      async complete() {
        throw new Error('Not implemented');
      },
      async resolve() {
        return {};
      },
      async refresh() {
        throw new Error('OAuth refresh revoked');
      },
    };

    const providers = new Map<string, EnrollmentProvider>([['cloud-code', failingProvider]]);
    const configResolver = {
      async resolveConfig() {
        return {};
      },
    };

    const service = new LocalAccountTransportService(keyring, providers, configResolver);

    const pastExpiresAt = new Date(Date.now() - 1000).toISOString();
    service.registerAccount({
      accountId: 'acct_failing_1',
      targetProviderId: 'gemini',
      transportProviderId: 'cloud-code',
      accessToken: 'old-token',
      refreshToken: 'bad-token',
      expiresAt: pastExpiresAt,
      status: 'active',
      metadata: { cloudaicompanionProject: 'test-project' },
    });

    await expect(
      service.acquire({
        targetProviderId: 'gemini',
        transportProviderId: 'cloud-code',
      }),
    ).rejects.toThrow(AccountTransportAcquireError);
  });
});
