import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import type { ReauthAlertEvent } from '../../src/service/reauth-alert.js';
import {
  createLlmMeshFacade,
  type ConfigResolver,
  type FacadeOptions,
  type KeyringAdapter,
  type LlmMeshAdministrativeFacade,
  type LlmMeshFacade,
} from '../../src/service/facade.js';

const seedPersistedAccount = async (
  keyring: KeyringAdapter,
  accountId: string,
  ownerScopeRef: string,
): Promise<void> => {
  const createdAt = '2026-08-20T10:00:00.000Z';
  const accountLabel = `${ownerScopeRef} Codex`;
  await keyring.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
    accountId, accountLabel, providerId: 'codex', status: 'active', createdAt,
    updatedAt: createdAt,
    account: {
      accountId, ownerScopeRef, accountLabel, targetProviderId: 'openai',
      transportProviderId: 'codex', status: 'active', enrollmentCompletedAt: createdAt,
    },
  }));
  await keyring.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({
    accountId, accessToken: `secret-${accountId}`,
    expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
  }));
};

describe('LlmMeshFacade', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('supplies optional Claude methods, resolver configuration and secret-free completions', async () => {
    const access = 'FAKE_FACADE_ACCESS_CANARY';
    const refresh = 'FAKE_FACADE_REFRESH_CANARY';
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: access,
      refresh_token: refresh, expires_in: 3600, scope: 'user:inference' })));
    vi.stubGlobal('fetch', fetchFn);
    const resolveConfig = vi.fn(async () => ({}));
    const facade = createLlmMeshFacade({ mode: 'portal', configResolver: { resolveConfig } });
    const { completeClaudeEnrollment, completeClaudeCredentialImport, ...oldSurface } = facade;
    const oldMock: LlmMeshFacade = oldSurface;
    expect(oldMock.completeClaudeEnrollment).toBeUndefined();
    expect(oldMock.completeClaudeCredentialImport).toBeUndefined();
    const session = await facade.enroll('claude-code', { ownerScope: 'owner', configRef: 'claude-profile',
      mode: 'portal', redirectUri: '' });
    expect(resolveConfig).toHaveBeenCalledWith('claude-profile');
    if (session.kind !== 'authorization-url') throw new Error('Wrong session');
    const code = `FAKE_FACADE_CODE_CANARY#${new URL(session.url).searchParams.get('state')}`;
    const browser = await completeClaudeEnrollment!(session.enrollmentId, code, 'owner');
    await expect(completeClaudeCredentialImport!(JSON.stringify({ accessToken: access,
      refreshToken: refresh, expiresAt: Date.now() + 3600_000, scopes: ['user:inference'] }), 'owner'))
      .rejects.toThrow('This Claude credential is already enrolled');
    const imported = await completeClaudeCredentialImport!(JSON.stringify({ accessToken: access,
      refreshToken: `${refresh}_IMPORT`, expiresAt: Date.now() + 3600_000, scopes: ['user:inference'] }), 'owner');
    expect(resolveConfig).toHaveBeenLastCalledWith('claude-code');
    expect(browser.accountId).not.toBe(imported.accountId);
    expect(JSON.stringify([browser, imported, await facade.listAccounts({ ownerScope: 'owner' })])).not.toContain('CANARY');
    const cancelled = await facade.enroll('claude-code', { ownerScope: 'owner', configRef: '', mode: 'cli', redirectUri: '' });
    await facade.cancel(cancelled.enrollmentId);
    await expect(completeClaudeEnrollment!(cancelled.enrollmentId, code, 'owner')).rejects.toThrow('unavailable');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(() => facade.getAdapter('claude-code')).toThrow('not available locally');
  });

  it('retains existing callback, polling and Muse completion delegation', async () => {
    const facade = createLlmMeshFacade({ mode: 'portal', configResolver: { async resolveConfig() { return {}; } } });
    for (const name of ['waitForCallback', 'pollForCompletion', 'completeMuseImport',
      'completeMuseDirectImport', 'completeMuseDeviceImport'] as const) {
      const spy = vi.spyOn(LocalAccountTransportService.prototype, name).mockResolvedValue({ accountId: 'safe', label: 'Safe' });
      const result = name === 'completeMuseImport' ? await facade[name]('session', '', 'owner')
        : name === 'completeMuseDirectImport' || name === 'completeMuseDeviceImport' ? await facade[name]('input', 'owner')
          : await facade[name]('session');
      expect(result).toEqual({ accountId: 'safe', label: 'Safe' });
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it('creates a facade instance with valid options', () => {
    const mockConfigResolver: ConfigResolver = {
      async resolveConfig(configRef) {
        return { ref: configRef };
      },
    };

    const mockKeyring: KeyringAdapter = {
      async getSecret() {
        return null;
      },
      async setSecret() {},
      async deleteSecret() {},
    };

    const options: FacadeOptions = {
      configResolver: mockConfigResolver,
      keyring: mockKeyring,
      mode: 'cli',
    };

    const facade: LlmMeshAdministrativeFacade = createLlmMeshFacade(options);

    expect(facade).toBeDefined();
    expect(typeof facade.enroll).toBe('function');
    expect(typeof facade.waitForCallback).toBe('function');
    expect(typeof facade.pollForCompletion).toBe('function');
    expect(typeof facade.cancel).toBe('function');
    expect(typeof facade.listAccounts).toBe('function');
    expect(typeof facade.removeAccount).toBe('function');
    expect(typeof facade.acquire).toBe('function');
    expect(typeof facade.release).toBe('function');
    expect(typeof facade.getAdapter).toBe('function');
    expect(typeof facade.createRoutePlanner).toBe('function');
  });

  it('throws an error if options is missing', () => {
    expect(() => createLlmMeshFacade(undefined as unknown as FacadeOptions)).toThrow(
      'LlmMeshFacade: options is required',
    );
  });

  it('delegates enroll and getAdapter to registered providers and adapters', async () => {
    const mockConfigResolver: ConfigResolver = {
      async resolveConfig() {
        return {};
      },
    };

    const facade = createLlmMeshFacade({
      configResolver: mockConfigResolver,
      mode: 'portal',
    });

    const session = await facade.enroll('cloud-code', {
      configRef: 'ref',
      mode: 'portal',
      redirectUri: 'https://localhost/cb',
      ownerScope: 'test',
    });
    expect(session.kind).toBe('authorization-url');

    await expect(
      facade.enroll('claude-code', {
        configRef: 'ref',
        mode: 'portal',
        redirectUri: 'https://localhost/cb',
        ownerScope: 'test',
      }),
    ).rejects.toThrow('redirect mismatch');

    const adapter = facade.getAdapter('cloud-code');
    expect(adapter).toBeDefined();
    expect(typeof adapter.execute).toBe('function');

    expect(() => facade.getAdapter('codex')).toThrow('not available locally');
  });

  it('lists and removes accounts only within the explicit owner scope', async () => {
    const keyring = new InMemoryKeyring();
    const createdAt = '2026-08-20T10:00:00.000Z';
    await keyring.setSecret(
      'sentropic-llm-mesh:accounts:index',
      JSON.stringify(['acct-owner-a', 'acct-owner-b']),
    );
    await seedPersistedAccount(keyring, 'acct-owner-a', 'owner-a');
    await seedPersistedAccount(keyring, 'acct-owner-b', 'owner-b');

    const facade = createLlmMeshFacade({
      configResolver: { async resolveConfig() { return {}; } },
      keyring,
      mode: 'cli',
    });

    const accounts = await facade.listAccounts({ ownerScope: 'owner-a' });
    expect(accounts).toEqual([{
      accountId: 'acct-owner-a',
      accountLabel: 'owner-a Codex',
      providerId: 'codex',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    }]);
    expect(JSON.stringify(accounts)).not.toContain('secret-acct-owner-a');
    await expect(facade.removeAccount('acct-owner-b', { ownerScope: 'owner-a' }))
      .rejects.toThrow("Account 'acct-owner-b' not found");

    await expect(facade.removeAccount('acct-owner-a', { ownerScope: 'owner-a' }))
      .resolves.toEqual({ accountId: 'acct-owner-a', removed: true });
    await expect(keyring.getSecret('sentropic-llm-mesh:acct-owner-a:public'))
      .resolves.toBeNull();
    await expect(keyring.getSecret('sentropic-llm-mesh:acct-owner-a:envelope'))
      .resolves.toBeNull();
    await expect(keyring.getSecret('sentropic-llm-mesh:accounts:index'))
      .resolves.toBe(JSON.stringify(['acct-owner-a', 'acct-owner-b']));
    await expect(facade.acquire({
      ownerScopeRef: 'owner-a',
      targetProviderId: 'openai',
      transportProviderId: 'codex',
    })).rejects.toThrow('No active codex account transport for openai');
  });

  it('keeps a failed removal retryable and fail-closed across restart', async () => {
    const store = new InMemoryKeyring();
    let rejectEnvelopeDelete = true;
    const keyring: KeyringAdapter = {
      getSecret: (key) => store.getSecret(key),
      setSecret: (key, secret) => store.setSecret(key, secret),
      async deleteSecret(key) {
        if (rejectEnvelopeDelete && key.endsWith(':envelope')) {
          rejectEnvelopeDelete = false;
          throw new Error('injected keyring failure');
        }
        await store.deleteSecret(key);
      },
    };
    await keyring.setSecret(
      'sentropic-llm-mesh:accounts:index',
      JSON.stringify(['acct-owner-a']),
    );
    await seedPersistedAccount(keyring, 'acct-owner-a', 'owner-a');
    const options = {
      configResolver: { async resolveConfig() { return {}; } }, keyring, mode: 'cli' as const,
    };
    const facade = createLlmMeshFacade(options);

    await expect(facade.removeAccount('acct-owner-a', { ownerScope: 'owner-a' }))
      .rejects.toThrow('injected keyring failure');
    const restarted = createLlmMeshFacade(options);
    await expect(restarted.acquire({
      ownerScopeRef: 'owner-a', targetProviderId: 'openai', transportProviderId: 'codex',
    })).rejects.toThrow('No active codex account transport for openai');

    await expect(restarted.removeAccount('acct-owner-a', { ownerScope: 'owner-a' }))
      .resolves.toEqual({ accountId: 'acct-owner-a', removed: true });
    await expect(restarted.listAccounts({ ownerScope: 'owner-a' })).resolves.toEqual([]);
  });

  it('wires custodian clock, sink and policy through to the cycle', async () => {
    // m1: the facade `custodian` options must reach the service. The injected
    // clock decides expiry, the sink receives the no-grant flip, and the tiny
    // custom window skips an account the default 10-minute floor would
    // refresh — with no provider call (fetch is stubbed to throw).
    const nowMs = Date.parse('2027-01-01T00:00:00.000Z');
    const alerts: ReauthAlertEvent[] = [];
    const keyring = new InMemoryKeyring();
    const facade = createLlmMeshFacade({ mode: 'portal',
      configResolver: { async resolveConfig() { return {}; } }, keyring,
      custodian: { now: () => nowMs,
        reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } },
        refreshPolicy: { skewRatio: 0.001, minSkewMs: 0 } } });
    const iso = (ms: number): string => new Date(ms).toISOString();
    const seedPersisted = async (accountId: string, ownerScopeRef: string,
      expiresAt: string, grant: boolean): Promise<void> => {
      await keyring.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
        accountId, accountLabel: `${ownerScopeRef} label`, providerId: 'cloud-code',
        status: 'active', createdAt: iso(nowMs), updatedAt: iso(nowMs),
        account: { accountId, ownerScopeRef, accountLabel: `${ownerScopeRef} label`,
          targetProviderId: 'openai', transportProviderId: 'cloud-code',
          status: 'active', enrollmentCompletedAt: iso(nowMs) },
      }));
      await keyring.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({
        accountId, accessToken: `old-access-${accountId}`,
        ...(grant ? { refreshToken: `grant-${accountId}` } : {}),
        expiresAt, authClientConfigVersion: 'v1.0.0',
      }));
    };
    await seedPersisted('facade-tiny', 'owner-tiny', iso(nowMs + 5 * 60_000), true);
    await seedPersisted('facade-old', 'owner-old', iso(nowMs - 60_000), false);
    await keyring.setSecret('sentropic-llm-mesh:accounts:index',
      JSON.stringify(['facade-tiny', 'facade-old']));
    const fetchFn = vi.fn(async () => { throw new Error('no network in unit tests'); });
    vi.stubGlobal('fetch', fetchFn);
    const report = await facade.runCustodianRefreshCycle();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(report.checked).toBe(2);
    expect(report.accounts.find((entry) => entry.ownerScopeRef === 'owner-tiny'))
      .toMatchObject({ action: 'skipped-healthy', readiness: 'ready' });
    expect(report.accounts.find((entry) => entry.ownerScopeRef === 'owner-old'))
      .toMatchObject({ action: 'expired-no-grant', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ownerScopeRef: 'owner-old', reason: 'expired-no-grant' });
    expect(JSON.stringify(report)).not.toContain('grant-facade');
  });

  it('restores the refresh window from updatedAt, not the enrollment age', async () => {
    // m1: a long-enrolled account with a freshly issued credential must not
    // refresh. The persisted `updatedAt` (issuance bound) decides the TTL,
    // not `enrollmentCompletedAt`. Seeded enrollment 3 h ago, credential
    // issued now, expiry in 60 min: window 15 min, remaining 60 — healthy.
    const nowMs = Date.parse('2027-01-01T00:00:00.000Z');
    const keyring = new InMemoryKeyring();
    const facade = createLlmMeshFacade({ mode: 'portal',
      configResolver: { async resolveConfig() { return {}; } }, keyring,
      custodian: { now: () => nowMs } });
    const iso = (ms: number): string => new Date(ms).toISOString();
    await keyring.setSecret('sentropic-llm-mesh:facade-aged:public', JSON.stringify({
      accountId: 'facade-aged', accountLabel: 'owner-aged label', providerId: 'cloud-code',
      status: 'active', createdAt: iso(nowMs - 180 * 60_000), updatedAt: iso(nowMs),
      account: { accountId: 'facade-aged', ownerScopeRef: 'owner-aged',
        accountLabel: 'owner-aged label', targetProviderId: 'openai',
        transportProviderId: 'cloud-code', status: 'active',
        enrollmentCompletedAt: iso(nowMs - 180 * 60_000) },
    }));
    await keyring.setSecret('sentropic-llm-mesh:facade-aged:envelope', JSON.stringify({
      accountId: 'facade-aged', accessToken: 'old-access-facade-aged',
      refreshToken: 'grant-facade-aged', expiresAt: iso(nowMs + 60 * 60_000),
      authClientConfigVersion: 'v1.0.0',
    }));
    await keyring.setSecret('sentropic-llm-mesh:accounts:index', JSON.stringify(['facade-aged']));
    const fetchFn = vi.fn(async () => { throw new Error('no network in unit tests'); });
    vi.stubGlobal('fetch', fetchFn);
    const report = await facade.runCustodianRefreshCycle();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(report.accounts).toHaveLength(1);
    expect(report.accounts[0]).toMatchObject({ action: 'skipped-healthy', readiness: 'ready' });
  });

  it('starts and stops the custodian loop through the facade', async () => {
    const facade = createLlmMeshFacade({ mode: 'portal',
      configResolver: { async resolveConfig() { return {}; } },
      keyring: new InMemoryKeyring(),
      custodian: { now: () => Date.parse('2027-01-01T00:00:00.000Z') } });
    const reports: unknown[] = [];
    const errors: unknown[] = [];
    const stop = facade.startCustodianLoop(60_000,
      (report) => { reports.push(report); }, (error) => { errors.push(error); });
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(errors).toEqual([]);
    stop();
    facade.stopCustodianLoop();
  });

  it('exposes the seat-bundle import entry and delegates canonical registration', async () => {
    const facade = createLlmMeshFacade({ mode: 'portal', configResolver: { async resolveConfig() { return {}; } } });
    const { parseCliSeatProfile } = await import('../../src/enrollment/cli-seat-import.js');
    const imported = await facade.importSeatBundle({
      bundle: parseCliSeatProfile({
        cli: 'claude',
        seatRef: 'seat-facade-01',
        refreshFamilyRef: 'family-facade-01',
        ownerScope: 'owner-seat-01',
        issuingClientRef: 'client-facade-01',
        endpointFamily: 'endpoint-facade-01',
        accountBinding: 'binding-facade-01',
        entitlementClass: 'lab-seat',
        epoch: 1,
        generation: 1,
        operationId: 'op-facade-01',
        issuedAt: '2026-10-17T00:00:00Z',
        providerExpiry: '2099-01-01T00:00:00Z',
        accessRef: 'access-facade-01',
      }),
      ownerScope: 'owner-seat-01',
    });
    expect(imported).toMatchObject({ accountId: 'seat-claude-seat-facade-01', idempotent: false });
  });
});
