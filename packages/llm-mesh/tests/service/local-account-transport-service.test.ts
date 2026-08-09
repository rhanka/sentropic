import { describe, expect, it, vi } from 'vitest';
import { AccountTransportAcquireError } from '../../src/account-transports.js';
import type { EnrollmentProvider, PreparedCredential } from '../../src/enrollment/contracts.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';

describe('LocalAccountTransportService', () => {
  it('restores a Cloud Code enrollment in a fresh runtime service', async () => {
    const keyring = new InMemoryKeyring();
    const provider = {
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
        throw new Error('Not implemented');
      },
      async waitForCallback() {
        return {
          accountId: 'acct_persisted_1',
          label: 'Cloud Code (test-project)',
          ownerScope: 'tenant-1:user-1',
          credential: {
            accountId: 'acct_persisted_1',
            accessToken: 'persisted-access-token',
            refreshToken: 'persisted-refresh-token',
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            authClientConfigVersion: 'v1.0.0',
          },
          metadata: { cloudaicompanionProject: 'test-project' },
        };
      },
    } satisfies EnrollmentProvider & {
      waitForCallback(enrollmentId: string): Promise<{
        accountId: string;
        label: string;
        ownerScope: string;
        credential: PreparedCredential;
        metadata: Record<string, unknown>;
      }>;
    };
    const providers = new Map<string, EnrollmentProvider>([['cloud-code', provider]]);
    const configResolver = { async resolveConfig() { return {}; } };
    const enrollmentService = new LocalAccountTransportService(
      keyring,
      providers,
      configResolver,
    );

    await enrollmentService.waitForCallback('enrollment-1');
    const publicKey = 'sentropic-llm-mesh:acct_persisted_1:public';
    const legacyPublic = JSON.parse(await keyring.getSecret(publicKey) ?? '{}');
    legacyPublic.account.targetProviderId = 'google';
    delete legacyPublic.account.ownerScopeRef;
    await keyring.setSecret(publicKey, JSON.stringify(legacyPublic));

    const runtimeService = new LocalAccountTransportService(
      keyring, providers, configResolver, 'tenant-1:user-1',
    );
    const acquisition = await runtimeService.acquire({
      targetProviderId: 'gemini',
      transportProviderId: 'cloud-code',
      ownerScopeRef: 'tenant-1:user-1',
    });
    expect(acquisition.material).toMatchObject({
      accountId: 'acct_persisted_1',
      accessToken: 'persisted-access-token',
      metadata: { cloudaicompanionProject: 'test-project' },
    });
    const persisted = await keyring.getSecret(publicKey);
    expect(JSON.parse(persisted ?? '{}').account.enrollmentCompletedAt).toEqual(
      expect.any(String),
    );
    expect(JSON.parse(persisted ?? '{}').account.ownerScopeRef).toBe('tenant-1:user-1');
  });

  it('registers a completed Codex enrollment as an OpenAI transport account', async () => {
    const keyring = new InMemoryKeyring();
    const provider = {
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() {
        return {
          accountId: 'acct_codex_1',
          label: 'Codex account',
          ownerScope: 'tenant-1:user-1',
          credential: {
            accountId: 'acct_codex_1',
            accessToken: 'codex-token',
            refreshToken: 'codex-refresh',
            authClientConfigVersion: 'v1.0.0',
          },
          metadata: {},
        };
      },
    } satisfies EnrollmentProvider & {
      pollForCompletion(enrollmentId: string): Promise<{
        accountId: string;
        label: string;
        ownerScope: string;
        credential: PreparedCredential;
        metadata: Record<string, unknown>;
      }>;
    };
    const service = new LocalAccountTransportService(
      keyring,
      new Map([['codex', provider]]),
      { async resolveConfig() { return {}; } },
    );

    await service.pollForCompletion('codex-enrollment');
    const acquisition = await service.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      ownerScopeRef: 'tenant-1:user-1',
    });

    expect(acquisition.material.accountId).toBe('acct_codex_1');
  });

  it('requires fresh Codex enrollment instead of silently claiming a legacy credential', async () => {
    const keyring = new InMemoryKeyring();
    const provider = {
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() { return {
        accountId: 'legacy-codex', label: 'Legacy Codex', ownerScope: 'owner-a',
        credential: {
          accountId: 'legacy-codex', accessToken: 'legacy-token',
          authClientConfigVersion: 'v1.0.0',
        },
        metadata: {},
      }; },
    } satisfies EnrollmentProvider & {
      pollForCompletion(enrollmentId: string): Promise<{
        accountId: string; label: string; ownerScope: string;
        credential: PreparedCredential; metadata: Record<string, unknown>;
      }>;
    };
    const providers = new Map<string, EnrollmentProvider>([['codex', provider]]);
    const configResolver = { async resolveConfig() { return {}; } };
    const enrollment = new LocalAccountTransportService(keyring, providers, configResolver);
    await enrollment.pollForCompletion('legacy');
    const key = 'sentropic-llm-mesh:legacy-codex:public';
    const record = JSON.parse(await keyring.getSecret(key) ?? '{}');
    delete record.account.ownerScopeRef;
    await keyring.setSecret(key, JSON.stringify(record));

    const restored = new LocalAccountTransportService(
      keyring, providers, configResolver, 'owner-a',
    );
    const directory = restored.createRouteDirectory({
      async generate() { throw new Error('unused'); },
      async stream() { return { async *[Symbol.asyncIterator]() {} }; },
    });
    const subject = { principalRef: 'session-a', ownerScopeRef: 'owner-a' };
    expect(await directory.listEligible(subject)).toEqual([]);
    expect(await directory.listDiagnostics?.(subject)).toEqual([{
      code: 'reenrollment-required', transportProviderId: 'codex',
      message: 'Codex enrollment must be renewed for owner-scoped routing',
    }]);
  });

  it('keeps executable account material inside an opaque route attempt', async () => {
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
    );
    service.registerAccount({
      accountId: 'secret-account-id', targetProviderId: 'openai', transportProviderId: 'codex',
      accessToken: 'secret-access-token', status: 'active', modelIds: ['gpt-5.6-terra'],
      enrollmentCompletedAt: '2026-08-08T00:00:00Z',
      ownerScopeRef: 'tenant-1:user-1',
    });
    const generate = vi.fn(async (request) => ({
      id: 'response-1', providerId: 'openai' as const, modelId: 'gpt-5.6-terra' as const,
      message: { role: 'assistant' as const, content: 'ok' }, text: 'ok', toolCalls: [],
      finishReason: 'stop' as const,
      providerMetadata: { receivedAuth: request.auth },
    }));
    const directory = service.createRouteDirectory({
      generate,
      async stream() { return { async *[Symbol.asyncIterator]() {} }; },
    });

    const accounts = await directory.listEligible({
      principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1',
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      diagnosticAccountRef: expect.stringMatching(/^acct_/), readiness: 'ready',
      targetProviderId: 'openai', transportProviderId: 'codex',
    });
    expect(JSON.stringify(accounts)).not.toContain('secret-access-token');
    expect(accounts[0]?.diagnosticAccountRef).not.toContain('secret-account-id');

    const attempt = await directory.prepareAttempt({
      subject: { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' },
      accountRef: accounts[0]!.accountRef,
      target: {
        requestedModel: 'claude-opus-5-high', providerId: 'openai',
        modelId: 'gpt-5.6-terra', transportProviderId: 'codex',
        effort: 'high', reason: 'alias',
      },
      requestId: 'request-1', attemptIndex: 0,
    });
    await attempt.generate({ messages: [{ role: 'user', content: 'hello' }] });
    await attempt.complete();
    const nextAttempt = await directory.prepareAttempt({
      subject: { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' },
      affinityRef: 'opaque-affinity-1',
      accountRef: accounts[0]!.accountRef,
      target: {
        requestedModel: 'claude-opus-5-high', providerId: 'openai',
        modelId: 'gpt-5.6-terra', transportProviderId: 'codex',
        effort: 'high', reason: 'alias',
      },
      requestId: 'request-2', attemptIndex: 0,
    });
    const thirdAttempt = await directory.prepareAttempt({
      subject: { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' },
      affinityRef: 'opaque-affinity-1',
      accountRef: accounts[0]!.accountRef,
      target: {
        requestedModel: 'claude-opus-5-high', providerId: 'openai',
        modelId: 'gpt-5.6-terra', transportProviderId: 'codex',
        effort: 'high', reason: 'alias',
      },
      requestId: 'request-3', attemptIndex: 0,
    });
    await nextAttempt.generate({ messages: [{ role: 'user', content: 'again' }] });
    await nextAttempt.complete();
    await thirdAttempt.generate({ messages: [{ role: 'user', content: 'again' }] });
    await thirdAttempt.complete();

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      auth: expect.objectContaining({
        material: expect.objectContaining({ accessToken: 'secret-access-token' }),
      }),
      reasoning: { effort: 'high' },
    }));
    const sessionIds = generate.mock.calls.slice(1).map(([request]) =>
      request.auth.material.metadata.stableSessionId);
    expect(new Set(sessionIds).size).toBe(1);
  });

  it('lists and prepares only accounts owned by the verified routing scope', async () => {
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
    );
    service.registerAccount({
      accountId: 'owner-a-account', ownerScopeRef: 'tenant-1:owner-a',
      targetProviderId: 'openai', transportProviderId: 'codex',
      accessToken: 'owner-a-token', status: 'active', modelIds: ['gpt-5.6-terra'],
    });
    service.registerAccount({
      accountId: 'owner-b-account', ownerScopeRef: 'tenant-1:owner-b',
      targetProviderId: 'openai', transportProviderId: 'codex',
      accessToken: 'owner-b-token', status: 'active', modelIds: ['gpt-5.6-terra'],
    });
    const directory = service.createRouteDirectory({
      async generate() { throw new Error('unused'); },
      async stream() { return { async *[Symbol.asyncIterator]() {} }; },
    });
    const ownerA = { principalRef: 'session-a', ownerScopeRef: 'tenant-1:owner-a' };
    const ownerB = { principalRef: 'session-b', ownerScopeRef: 'tenant-1:owner-b' };

    const ownerAAccounts = await directory.listEligible(ownerA);
    const ownerBAccounts = await directory.listEligible(ownerB);

    expect(ownerAAccounts).toHaveLength(1);
    expect(ownerBAccounts).toHaveLength(1);
    expect(ownerAAccounts[0]?.diagnosticAccountRef)
      .not.toBe(ownerBAccounts[0]?.diagnosticAccountRef);
    await expect(directory.prepareAttempt({
      subject: ownerA,
      accountRef: ownerBAccounts[0]!.accountRef,
      target: {
        requestedModel: 'gpt-5.6-terra', providerId: 'openai', modelId: 'gpt-5.6-terra',
        transportProviderId: 'codex', reason: 'exact',
      },
      requestId: 'foreign-account-attempt', attemptIndex: 0,
    })).rejects.toBeInstanceOf(AccountTransportAcquireError);
  });

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

    const second = await service.acquire({
      targetProviderId: 'gemini',
      transportProviderId: 'cloud-code',
    });
    expect(second.material.accessToken).toBe('refreshed-access-token');
    expect(second.material.refreshToken).toBe('refreshed-refresh-token');

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
