import { describe, expect, it, vi } from 'vitest';
import { AccountTransportAcquireError } from '../../src/account-transports.js';
import type { EnrollmentProvider, PreparedCredential } from '../../src/enrollment/contracts.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { InMemoryRoutePlanner } from '../../src/route-planner.js';
import { LAUNCH_ALIAS_TARGET_MAPPINGS } from '../../src/routing-targets.js';
import type { KeyringAdapter } from '../../src/service/facade.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';

describe('LocalAccountTransportService', () => {
  it.each(['cloud-code', 'codex'] as const)('does not replay %s refresh while the removal check awaits', async (transportProviderId) => {
    const keyring = new InMemoryKeyring();
    let responded = false;
    let blocked = false;
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const read = keyring.getSecret.bind(keyring);
    keyring.getSecret = async (key) => {
      if (responded && !blocked && key.endsWith(':removed')) {
        blocked = true; enter(); await gate;
      }
      return read(key);
    };
    const refresh = vi.fn(async (input) => {
      responded = true;
      return { accountId: input.accountId, accessToken: 'fresh', refreshToken: 'rotated',
        expiresAt: '2099-01-01T00:00:00Z', authClientConfigVersion: 'v1.0.0' };
    });
    const service = new LocalAccountTransportService(keyring,
      new Map([[transportProviderId, { refresh } as unknown as EnrollmentProvider]]),
      { async resolveConfig() { return {}; } });
    service.registerAccount({ accountId: 'removal-window', targetProviderId: 'openai', transportProviderId,
      accessToken: 'old', refreshToken: 'old-refresh', expiresAt: '2000-01-01T00:00:00Z', status: 'active' });
    const input = { targetProviderId: 'openai' as const, transportProviderId };
    const first = service.acquire(input);
    await entered;
    const second = service.acquire(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    expect((await Promise.all([first, second])).every((value) => value.material.refreshToken === 'rotated')).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['cloud-code', 'codex'] as const)('holds %s refresh until durable publication', async (transportProviderId) => {
    for (const failSave of [false, true]) {
      const keyring = new InMemoryKeyring();
      let entered!: () => void;
      let resume!: () => void;
      const saving = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { resume = resolve; });
      const save = keyring.setSecret.bind(keyring);
      keyring.setSecret = async (key, value) => {
        if (key.endsWith(':envelope')) {
          entered();
          await gate;
          if (failSave) throw new Error('CANARY_STORAGE_SECRET');
        }
        await save(key, value);
      };
      const refresh = vi.fn(async (input) => ({
        accountId: input.accountId, accessToken: 'fresh', refreshToken: 'rotated',
        expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
      }));
      const provider = { refresh } as unknown as EnrollmentProvider;
      const service = new LocalAccountTransportService(keyring,
        new Map([[transportProviderId, provider]]), { async resolveConfig() { return {}; } });
      service.registerAccount({ accountId: 'race', targetProviderId: 'openai',
        transportProviderId, accessToken: 'old', refreshToken: 'old-refresh',
        expiresAt: '2000-01-01T00:00:00Z', status: 'active' });
      const input = { targetProviderId: 'openai' as const, transportProviderId };
      let published = 0;
      const acquire = () => service.acquire(input).then((result) => { published++; return result; });
      const first = acquire();
      await saving;
      const second = acquire();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(published).toBe(0);
      resume();
      const results = await Promise.allSettled([first, second]);
      expect(results.map((result) => result.status)).toEqual(
        failSave ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled']);
      expect(refresh).toHaveBeenCalledTimes(1);
      if (failSave) {
        expect(JSON.stringify(results)).not.toContain('CANARY_STORAGE_SECRET');
        await expect(service.acquire(input)).rejects.toBeInstanceOf(AccountTransportAcquireError);
      } else {
        expect((await service.acquire(input)).material.accessToken).toBe('fresh');
      }
    }
  });

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
          metadata: {
            cloudaicompanionProject: 'test-project',
            cloudCodeTier: 'free-tier',
          },
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

    const completion = await enrollmentService.waitForCallback('enrollment-1');
    expect(completion).toMatchObject({
      cloudCodeTier: 'free-tier',
      warning: { code: 'cloud-code-free-tier' },
    });
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

  it('routes poll completion to the owning provider (mistral-vibe serving pair)', async () => {
    const keyring = new InMemoryKeyring();
    // A codex provider that MUST NOT be polled: the enrollment belongs to
    // mistral-vibe, and the legacy codex-first routing used to throw
    // "Enrollment session ... not found" for it.
    const codexProvider = {
      async start() { throw new Error('codex must not be polled'); },
      async complete() { throw new Error('codex must not be polled'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('codex must not be polled'); },
      async pollForCompletion() { throw new Error('codex must not be polled'); },
    } satisfies EnrollmentProvider;
    const mistralVibeProvider = {
      async start() {
        return {
          kind: 'authorization-url',
          enrollmentId: 'enr_mistral_vibe_1',
          url: 'https://console.mistral.ai/api/vibe/sign-in/proc_1',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() {
        return {
          accountId: 'acct_mistral_vibe_1',
          label: 'Mistral Vibe account',
          ownerScope: 'tenant-1:user-1',
          credential: {
            accountId: 'acct_mistral_vibe_1',
            accessToken: 'vibe-key',
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
      new Map([['codex', codexProvider], ['mistral-vibe', mistralVibeProvider]]),
      { async resolveConfig() { return {}; } },
    );

    const session = await service.enroll('mistral-vibe', {
      configRef: '',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1:0/callback',
      ownerScope: 'tenant-1:user-1',
    });
    const completion = await service.pollForCompletion(session.enrollmentId);
    expect(completion.accountId).toBe('acct_mistral_vibe_1');

    const acquisition = await service.acquire({
      targetProviderId: 'mistral',
      transportProviderId: 'mistral-vibe',
      ownerScopeRef: 'tenant-1:user-1',
    });
    expect(acquisition.material).toMatchObject({
      accountId: 'acct_mistral_vibe_1',
      accessToken: 'vibe-key',
    });
  });

  it('advertises only verified executable Cloud Code models when enrollment has no inventory', async () => {
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
    );
    service.registerAccount({
      accountId: 'cloud-without-inventory', ownerScopeRef: 'owner-a',
      targetProviderId: 'gemini', transportProviderId: 'cloud-code',
      accessToken: 'secret', status: 'active',
      metadata: { cloudaicompanionProject: 'project-a' },
    });
    const directory = service.createRouteDirectory({
      async generate() { throw new Error('unused'); },
      async stream() { return { async *[Symbol.asyncIterator]() {} }; },
    });

    const accounts = await directory.listEligible({
      principalRef: 'session-a', ownerScopeRef: 'owner-a',
    });

    expect(accounts[0]?.supportedModelIds).toEqual([
      'gemini-3.1-flash-lite',
      'claude-opus-4-6-thinking',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'gemini-3.1-pro',
    ]);
    expect(accounts[0]?.supportedModelIds).not.toContain('gemini-3.5-flash');
    expect(accounts[0]?.supportedModelIds).not.toContain('gemini-3.6-flash');
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

  it('does not repersist an account when refresh finishes after removal', async () => {
    const keyring = new InMemoryKeyring();
    let signalRefreshStarted!: () => void;
    let finishRefresh!: (credential: PreparedCredential) => void;
    const refreshStarted = new Promise<void>((resolve) => { signalRefreshStarted = resolve; });
    const refreshResult = new Promise<PreparedCredential>((resolve) => { finishRefresh = resolve; });
    const provider: EnrollmentProvider = {
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() {
        signalRefreshStarted();
        return refreshResult;
      },
    };
    const providers = new Map<string, EnrollmentProvider>([['codex', provider]]);
    const resolver = { async resolveConfig() { return {}; } };
    const accountId = 'acct_refresh_removal';
    const ownerScopeRef = 'owner-a';
    const createdAt = '2026-08-20T10:00:00.000Z';
    await keyring.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify([accountId]));
    await keyring.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
      accountId, accountLabel: 'Codex', providerId: 'codex', status: 'active',
      createdAt, updatedAt: createdAt,
      account: {
        accountId, ownerScopeRef, accountLabel: 'Codex', targetProviderId: 'openai',
        transportProviderId: 'codex', status: 'active', enrollmentCompletedAt: createdAt,
      },
    }));
    await keyring.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({
      accountId, accessToken: 'expired-access', refreshToken: 'refresh-token',
      expiresAt: '2020-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
    }));
    const service = new LocalAccountTransportService(keyring, providers, resolver);

    const pendingAcquire = service.acquire({
      ownerScopeRef, targetProviderId: 'openai', transportProviderId: 'codex',
    });
    await refreshStarted;
    await service.removeAccount(accountId, ownerScopeRef);
    finishRefresh({
      accountId, accessToken: 'resurrected-access', refreshToken: 'resurrected-refresh',
      expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
    });

    await expect(pendingAcquire).rejects.toThrow(AccountTransportAcquireError);
    await expect(keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`))
      .resolves.toBeNull();
    await expect(keyring.getSecret(`sentropic-llm-mesh:${accountId}:envelope`))
      .resolves.toBeNull();
    const restarted = new LocalAccountTransportService(keyring, providers, resolver);
    await expect(restarted.acquire({
      ownerScopeRef, targetProviderId: 'openai', transportProviderId: 'codex',
    })).rejects.toThrow(AccountTransportAcquireError);
  });

  it('does not let a foreign-owner enrollment clear a removal barrier', async () => {
    const keyring = new InMemoryKeyring();
    let ownerScope = 'owner-a';
    const provider = {
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() { return {
        accountId: 'acct_owner_collision', label: 'Codex', ownerScope,
        credential: {
          accountId: 'acct_owner_collision', accessToken: `token-${ownerScope}`,
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
    const service = new LocalAccountTransportService(
      keyring, new Map([['codex', provider]]), { async resolveConfig() { return {}; } },
    );
    await service.pollForCompletion('owner-a-enrollment');
    await service.removeAccount('acct_owner_collision', 'owner-a');

    ownerScope = 'owner-b';
    await expect(service.pollForCompletion('owner-b-enrollment'))
      .rejects.toThrow("Account 'acct_owner_collision' belongs to another owner scope");
    await expect(service.listAccounts('owner-a')).resolves.toEqual([]);
    await expect(service.listAccounts('owner-b')).resolves.toEqual([]);
    await expect(keyring.getSecret('sentropic-llm-mesh:acct_owner_collision:removed'))
      .resolves.not.toBeNull();
  });

  it('does not let a foreign-owner enrollment replace an active account', async () => {
    const keyring = new InMemoryKeyring();
    let ownerScope = 'owner-a';
    const provider = {
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() { return {
        accountId: 'acct_active_collision', label: 'Codex', ownerScope,
        credential: {
          accountId: 'acct_active_collision', accessToken: `token-${ownerScope}`,
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
    const service = new LocalAccountTransportService(
      keyring, new Map([['codex', provider]]), { async resolveConfig() { return {}; } },
    );
    await service.pollForCompletion('owner-a-enrollment');

    ownerScope = 'owner-b';
    await expect(service.pollForCompletion('owner-b-enrollment'))
      .rejects.toThrow("Account 'acct_active_collision' belongs to another owner scope");
    await expect(service.acquire({
      ownerScopeRef: 'owner-a', targetProviderId: 'openai', transportProviderId: 'codex',
    })).resolves.toMatchObject({ material: { accessToken: 'token-owner-a' } });
    await expect(service.acquire({
      ownerScopeRef: 'owner-b', targetProviderId: 'openai', transportProviderId: 'codex',
    })).rejects.toThrow(AccountTransportAcquireError);
    const persisted = await keyring.getSecret('sentropic-llm-mesh:acct_active_collision:public');
    expect(JSON.parse(persisted ?? '{}').account.ownerScopeRef).toBe('owner-a');
  });

  it('atomically assigns a colliding account ID to only one concurrent owner', async () => {
    const keyring = new InMemoryKeyring();
    const providerFor = (ownerScope: string): EnrollmentProvider & {
      pollForCompletion(enrollmentId: string): Promise<{
        accountId: string; label: string; ownerScope: string;
        credential: PreparedCredential; metadata: Record<string, unknown>;
      }>;
    } => ({
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() { return {
        accountId: 'acct_concurrent_collision', label: 'Codex', ownerScope,
        credential: {
          accountId: 'acct_concurrent_collision', accessToken: `token-${ownerScope}`,
          authClientConfigVersion: 'v1.0.0',
        },
        metadata: {},
      }; },
    });
    const resolver = { async resolveConfig() { return {}; } };
    const ownerA = new LocalAccountTransportService(
      keyring, new Map([['codex', providerFor('owner-a')]]), resolver,
    );
    const ownerB = new LocalAccountTransportService(
      keyring, new Map([['codex', providerFor('owner-b')]]), resolver,
    );

    const outcomes = await Promise.allSettled([
      ownerA.pollForCompletion('owner-a'),
      ownerB.pollForCompletion('owner-b'),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = outcomes[0]?.status === 'fulfilled' ? 'owner-a' : 'owner-b';
    const loser = winner === 'owner-a' ? 'owner-b' : 'owner-a';
    const restored = new LocalAccountTransportService(keyring, new Map(), resolver);
    await expect(restored.acquire({
      ownerScopeRef: winner, targetProviderId: 'openai', transportProviderId: 'codex',
    })).resolves.toMatchObject({ material: { accessToken: `token-${winner}` } });
    await expect(restored.acquire({
      ownerScopeRef: loser, targetProviderId: 'openai', transportProviderId: 'codex',
    })).rejects.toThrow(AccountTransportAcquireError);
  });

  it('observes same-owner re-enrollment across service instances', async () => {
    const keyring = new InMemoryKeyring();
    let accessToken = 'old-token';
    const provider = {
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() { return {
        accountId: 'acct_cross_process', label: 'Codex', ownerScope: 'owner-a',
        credential: {
          accountId: 'acct_cross_process', accessToken,
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
    const resolver = { async resolveConfig() { return {}; } };
    const first = new LocalAccountTransportService(keyring, providers, resolver);
    const second = new LocalAccountTransportService(keyring, providers, resolver);
    await first.pollForCompletion('initial');
    await second.removeAccount('acct_cross_process', 'owner-a');
    await expect(first.acquire({
      ownerScopeRef: 'owner-a', targetProviderId: 'openai', transportProviderId: 'codex',
    })).rejects.toThrow(AccountTransportAcquireError);

    accessToken = 'new-token';
    await second.pollForCompletion('reenrollment');
    await expect(first.acquire({
      ownerScopeRef: 'owner-a', targetProviderId: 'openai', transportProviderId: 'codex',
    })).resolves.toMatchObject({ material: { accessToken: 'new-token' } });
  });

  it('does not reinsert an account index entry when enrollment races with removal', async () => {
    const store = new InMemoryKeyring();
    let envelopeWritten = false;
    let indexReadBlocked = false;
    let signalIndexRead!: () => void;
    let resumeIndexRead!: () => void;
    const indexRead = new Promise<void>((resolve) => { signalIndexRead = resolve; });
    const indexResume = new Promise<void>((resolve) => { resumeIndexRead = resolve; });
    const indexKey = 'sentropic-llm-mesh:accounts:index';
    const keyring: KeyringAdapter = {
      async getSecret(key) {
        if (key === indexKey && envelopeWritten && !indexReadBlocked) {
          indexReadBlocked = true;
          const snapshot = await store.getSecret(key);
          signalIndexRead();
          await indexResume;
          return snapshot;
        }
        return store.getSecret(key);
      },
      async setSecret(key, secret) {
        await store.setSecret(key, secret);
        if (key === 'sentropic-llm-mesh:acct_index_race:envelope') envelopeWritten = true;
      },
      setSecretIfAbsent: (key, secret) => store.setSecretIfAbsent(key, secret),
      deleteSecret: (key) => store.deleteSecret(key),
    };
    const provider = {
      async start() { throw new Error('Not implemented'); },
      async complete() { throw new Error('Not implemented'); },
      async resolve() { return {}; },
      async refresh() { throw new Error('Not implemented'); },
      async pollForCompletion() { return {
        accountId: 'acct_index_race', label: 'Codex', ownerScope: 'owner-a',
        credential: {
          accountId: 'acct_index_race', accessToken: 'token',
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
    const service = new LocalAccountTransportService(
      keyring, new Map([['codex', provider]]), { async resolveConfig() { return {}; } },
    );

    const pendingEnrollment = service.pollForCompletion('racing-enrollment');
    await indexRead;
    await service.removeAccount('acct_index_race', 'owner-a');
    resumeIndexRead();

    await expect(pendingEnrollment).rejects.toThrow("Account 'acct_index_race' has been removed");
    await expect(store.getSecret(indexKey))
      .resolves.toBe(JSON.stringify(['acct_index_race']));
  });

  it('serves the standard alias through Sol 6.1 with forced effort', async () => {
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
    );
    service.registerAccount({
      accountId: 'sol-account', targetProviderId: 'openai', transportProviderId: 'codex',
      accessToken: 'sol-token', status: 'active', modelIds: ['gpt-6.1-sol'],
      enrollmentCompletedAt: '2026-08-08T00:00:00Z',
      ownerScopeRef: 'tenant-1:user-1',
    });
    const seen: unknown[] = [];
    const runtimeRequest = async (request: unknown) => {
      seen.push(request);
      return {
        id: 'response-1', providerId: 'openai' as const, modelId: 'gpt-6.1-sol' as const,
        message: { role: 'assistant' as const, content: 'ok' }, text: 'ok', toolCalls: [],
        finishReason: 'stop' as const, providerMetadata: {},
      };
    };
    const generate = vi.fn(runtimeRequest);
    const stream = vi.fn(async (request: unknown) => {
      seen.push(request);
      return { async *[Symbol.asyncIterator]() {} };
    });
    const directory = service.createRouteDirectory({ generate, stream });
    const subject = { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' };

    // Served allowlists carry Sol, never the alias.
    const accounts = await directory.listEligible(subject);
    expect(accounts.map((account) => account.supportedModelIds)).toEqual([['gpt-6.1-sol']]);

    const attempt = await directory.prepareAttempt({
      subject,
      accountRef: accounts[0]!.accountRef,
      target: {
        requestedModel: 'claude-opus-5-5', providerId: 'openai',
        modelId: 'gpt-6.1-sol', transportProviderId: 'codex', reason: 'alias',
        effort: 'high',
      },
      requestId: 'request-1', attemptIndex: 0,
    });
    await attempt.generate({ messages: [{ role: 'user', content: 'hello' }] });
    await attempt.stream({ messages: [{ role: 'user', content: 'hello' }] });
    // Alias retention in route diagnostics is pinned at plan level (M6).
    expect(seen).toHaveLength(2);
    for (const request of seen) {
      expect(request).toMatchObject({
        providerId: 'openai', modelId: 'gpt-6.1-sol', reasoning: { effort: 'high' },
      });
    }
  });

  it('lets the standard alias target effort override the request effort', async () => {
    expect(LAUNCH_ALIAS_TARGET_MAPPINGS['claude-opus-5-5'])
      .toMatchObject({ providerId: 'muse', model: 'muse-spark-1.3-contributor' });
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
    );
    service.registerAccount({
      accountId: 'sol-account', targetProviderId: 'openai', transportProviderId: 'codex',
      accessToken: 'sol-token', status: 'active', modelIds: ['gpt-6.1-sol'],
      enrollmentCompletedAt: '2026-08-08T00:00:00Z',
      ownerScopeRef: 'tenant-1:user-1',
    });
    const generate = vi.fn(async () => ({
      id: 'response-1', providerId: 'openai' as const, modelId: 'gpt-6.1-sol' as const,
      message: { role: 'assistant' as const, content: 'ok' }, text: 'ok', toolCalls: [],
      finishReason: 'stop' as const, providerMetadata: {},
    }));
    const directory = service.createRouteDirectory({
      generate,
      async stream() { return { async *[Symbol.asyncIterator]() {} }; },
    });
    const subject = { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' };
    const accounts = await directory.listEligible(subject);
    const attempt = await directory.prepareAttempt({
      subject,
      accountRef: accounts[0]!.accountRef,
      target: {
        requestedModel: 'claude-opus-5-5', providerId: 'openai',
        modelId: 'gpt-6.1-sol', transportProviderId: 'codex', reason: 'alias',
        effort: 'high',
      },
      requestId: 'request-1', attemptIndex: 0,
    });

    await attempt.generate({
      messages: [{ role: 'user', content: 'hello' }],
      reasoning: { effort: 'xhigh' },
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai', modelId: 'gpt-6.1-sol', reasoning: { effort: 'high' },
    }));
  });

  it.each([false, true])(
    'keeps the stored effort override when switching to the standard alias (quoted: %s)',
    async (quoted) => {
      const service = new LocalAccountTransportService(
        new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
      );
      service.registerAccount({
        accountId: 'sol-account', targetProviderId: 'openai', transportProviderId: 'codex',
        accessToken: 'sol-token', status: 'active', modelIds: ['gpt-6.1-sol'],
        enrollmentCompletedAt: '2026-08-08T00:00:00Z',
        ownerScopeRef: 'tenant-1:user-1',
      });
      const generate = vi.fn(async () => ({
        id: 'response-1', providerId: 'openai' as const, modelId: 'gpt-6.1-sol' as const,
        message: { role: 'assistant' as const, content: 'ok' }, text: 'ok', toolCalls: [],
        finishReason: 'stop' as const, providerMetadata: {},
      }));
      const directory = service.createRouteDirectory({
        generate,
        async stream() { return { async *[Symbol.asyncIterator]() {} }; },
      });
      const planner = new InMemoryRoutePlanner({ directory });
      const subject = { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' };
      const affinityKey = quoted ? 'effort-drop-quoted' : 'effort-drop';

      // Bind the affinity through the effort-bearing Sol alias.
      const first = await planner.plan(subject, {
        requestedModel: 'claude-opus-5-high', affinityKey,
      });
      await (await planner.prepareAttempt(
        subject, first.planRef, first.candidateRefs[0]!, 'req-1', 0,
      )).complete();
      expect(planner.describeAffinity(subject, affinityKey)?.target).toMatchObject({
        modelId: 'gpt-6.1-sol', effort: 'xhigh',
      });

      const quote = quoted ? planner.quote({
        requestedModel: 'claude-opus-5-5',
        ceiling: { inputTokens: 1_000, outputTokens: 1_000 },
        now: new Date(),
      }) : undefined;
      const plan = await planner.plan(subject, {
        requestedModel: 'claude-opus-5-5', affinityKey, ...(quote ? { quote } : {}),
      });
      const attempt = await planner.prepareAttempt(
        subject, plan.planRef, plan.candidateRefs[0]!, 'req-2', 0,
      );

      // The sticky target keeps its stored effort: the runtime forces it ...
      await attempt.generate({ messages: [{ role: 'user', content: 'hello' }] });
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'openai', modelId: 'gpt-6.1-sol', reasoning: { effort: 'xhigh' },
      }));
      // ... and it overrides the request's own effort.
      await attempt.generate({
        messages: [{ role: 'user', content: 'hello' }],
        reasoning: { effort: 'low' },
      });
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'openai', modelId: 'gpt-6.1-sol', reasoning: { effort: 'xhigh' },
      }));
    },
  );

  it('serves every enrolled transport for the standard alias', async () => {
    const service = new LocalAccountTransportService(
      new InMemoryKeyring(), new Map(), { async resolveConfig() { return {}; } },
    );
    for (const account of [
      {
        accountId: 'claude-account', targetProviderId: 'anthropic',
        transportProviderId: 'claude-code', modelIds: ['claude-opus-5'],
      },
      {
        accountId: 'cloud-account', targetProviderId: 'gemini',
        transportProviderId: 'cloud-code', modelIds: ['gemini-3.8-flash'],
      },
      {
        accountId: 'muse-account', targetProviderId: 'muse',
        transportProviderId: 'muse', modelIds: ['muse-spark-1.3-contributor'],
      },
      {
        accountId: 'sol-account', targetProviderId: 'openai',
        transportProviderId: 'codex', modelIds: ['gpt-6.1-sol'],
      },
    ]) {
      service.registerAccount({
        ...account,
        accessToken: `${account.accountId}-token`, status: 'active',
        enrollmentCompletedAt: '2026-08-08T00:00:00Z',
        ownerScopeRef: 'tenant-1:user-1',
      });
    }
    const planner = new InMemoryRoutePlanner({
      directory: service.createRouteDirectory({
        async generate() { throw new Error('unused'); },
        async stream() { return { async *[Symbol.asyncIterator]() {} }; },
      }),
    });
    const plan = await planner.plan(
      { principalRef: 'user-1', ownerScopeRef: 'tenant-1:user-1' },
      { requestedModel: 'claude-opus-5-5' },
    );

    expect(plan.diagnostics.length).toBeGreaterThan(0);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.actualTransportProviderId).sort())
      .toEqual(['cloud-code', 'codex', 'muse']);
    for (const diagnostic of plan.diagnostics) {
      expect(diagnostic.actualProviderId).not.toBe('anthropic');
    }
  });
});
