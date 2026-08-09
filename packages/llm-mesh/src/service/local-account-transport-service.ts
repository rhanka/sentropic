import {
  AccountTransportAcquireError,
  InMemoryAccountTransportCoordinator,
  type AccountTransportAccount,
  type AccountTransportAcquireInput,
  type AccountTransportAcquisition,
} from '../account-transports.js';
import type {
  AccountPublic,
  CompleteEnrollmentInput,
  CredentialEnvelope,
  EnrollmentProvider,
  EnrollmentSession,
  PreparedCredential,
  RefreshInput,
  StartEnrollmentInput,
} from '../enrollment/contracts.js';
import type { ConfigResolver, KeyringAdapter } from './facade.js';
import { listModelProfilesByProvider } from '../catalog.js';
import type { LlmMesh } from '../mesh.js';
import type { ProviderId } from '../providers.js';
import type {
  AccountDirectoryPort, EligibleAccountDescriptor, PlannedRouteTarget,
  PreparedRouteAttempt, RouteFailureClassification,
} from '../routing-contracts.js';

type PersistedAccountTransportAccount = Omit<
  AccountTransportAccount,
  'accessToken' | 'refreshToken' | 'expiresAt'
>;

interface AccountPublicRecord extends AccountPublic {
  account: PersistedAccountTransportAccount;
}

export class LocalAccountTransportService {
  private static readonly accountIndexKey = 'sentropic-llm-mesh:accounts:index';
  private readonly coordinator: InMemoryAccountTransportCoordinator;
  private readonly accountsMap = new Map<string, AccountTransportAccount>();
  private readonly credentialVersions = new Map<string, string>();
  private readonly refreshInFlight = new Map<string, Promise<PreparedCredential>>();
  private routeAttemptSequence = 0;

  constructor(
    private readonly keyring: KeyringAdapter,
    private readonly providers: Map<string, EnrollmentProvider>,
    private readonly configResolver: ConfigResolver,
  ) {
    this.coordinator = new InMemoryAccountTransportCoordinator();
  }

  // ── Enrollment (called via facade by h2a CLI) ──────────────────────────
  async enroll(providerId: string, input: StartEnrollmentInput): Promise<EnrollmentSession> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Enrollment provider '${providerId}' not registered`);
    }
    return provider.start(input);
  }

  async waitForCallback(enrollmentId: string): Promise<{ accountId: string; label: string }> {
    const provider = this.providers.get('cloud-code');
    if (!provider?.waitForCallback) {
      throw new Error("No enrollment provider with 'waitForCallback' registered");
    }
    const res = await provider.waitForCallback(enrollmentId);
    if (res.credential) {
      const now = new Date().toISOString();
      const account: AccountTransportAccount = {
        accountId: res.accountId,
        accountLabel: res.label,
        targetProviderId: 'gemini',
        transportProviderId: 'cloud-code',
        accessToken: res.credential.accessToken,
        refreshToken: res.credential.refreshToken,
        expiresAt: res.credential.expiresAt,
        status: 'active',
        enrollmentCompletedAt: now,
        metadata: res.metadata,
      };
      this.registerAccount(account, res.credential.authClientConfigVersion);
      await this.persistCredential(
        {
          accountId: account.accountId,
          accountLabel: res.label,
          providerId: 'cloud-code',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        {
          accountId: account.accountId,
          accessToken: res.credential.accessToken,
          refreshToken: res.credential.refreshToken,
          expiresAt: res.credential.expiresAt,
          authClientConfigVersion: res.credential.authClientConfigVersion,
        },
        account,
      );
    }
    return { accountId: res.accountId, label: res.label };
  }

  async pollForCompletion(enrollmentId: string): Promise<{ accountId: string; label: string }> {
    const provider = this.providers.get('codex');
    if (!provider?.pollForCompletion) {
      throw new Error("No enrollment provider with 'pollForCompletion' registered");
    }
    const res = await provider.pollForCompletion(enrollmentId);
    if (res.credential) {
      const now = new Date().toISOString();
      // P0-4: Persist credentials obtained via device flow poll into keyring/accounts
      const account: AccountTransportAccount = {
        accountId: res.accountId,
        accountLabel: res.label,
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        accessToken: res.credential.accessToken,
        refreshToken: res.credential.refreshToken,
        expiresAt: res.credential.expiresAt,
        status: 'active',
        enrollmentCompletedAt: now,
        metadata: res.metadata,
      };
      this.registerAccount(account, res.credential.authClientConfigVersion);
      await this.persistCredential(
        {
          accountId: res.accountId,
          accountLabel: res.label,
          providerId: 'codex',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        {
          accountId: res.accountId,
          accessToken: res.credential.accessToken,
          refreshToken: res.credential.refreshToken,
          expiresAt: res.credential.expiresAt,
          authClientConfigVersion: res.credential.authClientConfigVersion,
        },
        account,
      );
    }
    return { accountId: res.accountId, label: res.label };
  }

  async cancel(enrollmentId: string): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.cancel) {
        await provider.cancel(enrollmentId);
      }
    }
  }

  // ── Account Registration for Coordinator ──────────────────────────────
  registerAccount(account: AccountTransportAccount, configVersion = 'v1.0.0'): void {
    this.accountsMap.set(account.accountId, account);
    this.credentialVersions.set(account.accountId, configVersion);
    this.coordinator.addAccount(account);
  }

  // ── Runtime (called via facade by h2a gateway) ─────────────────────────
  async acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition> {
    await this.restorePersistedAccounts();
    // Attempt coordinator acquisition
    let acquisition: AccountTransportAcquisition;
    try {
      acquisition = await this.coordinator.acquire(input);
    } catch (err) {
      if (err instanceof AccountTransportAcquireError) {
        throw err;
      }
      throw new AccountTransportAcquireError(
        `Acquire failed for ${input.transportProviderId}`,
        'no_active_account',
      );
    }

    const account = this.accountsMap.get(acquisition.material.accountId ?? '');
    const nowMs = typeof input.now === 'number' ? input.now : Date.now();

    // Check if access token is expired
    if (account && account.expiresAt) {
      const expiresAtMs = new Date(account.expiresAt).getTime();
      if (expiresAtMs <= nowMs) {
        try {
          const version = this.credentialVersions.get(account.accountId) ?? 'v1.0.0';
          const refreshed = await this.refreshToken({
            accountId: account.accountId,
            refreshToken: account.refreshToken ?? undefined,
            credentialVersion: version,
          });

          // Atomic persistence of updated credentials
          account.accessToken = refreshed.accessToken;
          if (refreshed.refreshToken) {
            account.refreshToken = refreshed.refreshToken;
          }
          account.expiresAt = refreshed.expiresAt;

          await this.persistCredential(
            {
              accountId: account.accountId,
              accountLabel: account.accountLabel ?? undefined,
              providerId: account.transportProviderId,
              status: 'active',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              accountId: account.accountId,
              accessToken: refreshed.accessToken,
              refreshToken: account.refreshToken ?? undefined,
              expiresAt: refreshed.expiresAt,
              authClientConfigVersion: refreshed.authClientConfigVersion,
            },
            account,
          );

          // Update material with refreshed token
          acquisition.material.accessToken = refreshed.accessToken;
          if (refreshed.refreshToken) {
            acquisition.material.refreshToken = refreshed.refreshToken;
          }
          acquisition.material.expiresAt = refreshed.expiresAt;
        } catch (refreshErr) {
          await this.markReauthRequired(account.accountId);
          throw new AccountTransportAcquireError(
            `Account ${account.accountId} token refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
            'no_active_account',
          );
        }
      }
    }

    return acquisition;
  }

  async release(acquisition: AccountTransportAcquisition): Promise<void> {
    // Q2B abort -> release reservation without recording an outcome / zero account impact
    await acquisition.release?.();
  }

  createRouteDirectory(runtime: Pick<LlmMesh, 'generate' | 'stream'>): AccountDirectoryPort {
    return {
      listEligible: async () => this.listRouteAccounts(),
      prepareAttempt: async (input) => {
        const acquisition = await this.acquire({
          accountId: input.accountRef,
          targetProviderId: input.target.providerId,
          transportProviderId: input.target.transportProviderId,
          modelId: input.target.modelId,
          userId: input.subject.principalRef,
          requestId: `${input.requestId}:${input.attemptIndex}`,
        });
        this.routeAttemptSequence += 1;
        return this.routeAttempt(runtime, acquisition, input.target,
          `attempt_${this.routeAttemptSequence.toString(36)}`);
      },
    };
  }

  private async listRouteAccounts(): Promise<readonly EligibleAccountDescriptor[]> {
    await this.restorePersistedAccounts();
    return [...this.accountsMap.values()].map((account) => ({
      accountRef: account.accountId,
      diagnosticAccountRef: this.diagnosticAccountRef(account.accountId),
      targetProviderId: account.targetProviderId,
      transportProviderId: account.transportProviderId,
      supportedModelIds: account.modelIds?.length
        ? account.modelIds
        : listModelProfilesByProvider(account.targetProviderId as ProviderId)
          .map((profile) => profile.modelId),
      enrollmentCompletedAt: account.enrollmentCompletedAt ?? '1970-01-01T00:00:00.000Z',
      readiness: account.status === 'active' || account.status === undefined
        ? 'ready'
        : account.status === 'reauth_required'
          ? 'reauth-required'
          : account.status,
      revision: [
        this.credentialVersions.get(account.accountId) ?? 'v1.0.0',
        account.expiresAt ?? '', account.status ?? 'active', account.enrollmentCompletedAt ?? '',
      ].join(':'),
    }));
  }

  private routeAttempt(
    runtime: Pick<LlmMesh, 'generate' | 'stream'>,
    acquisition: AccountTransportAcquisition,
    target: PlannedRouteTarget,
    attemptRef: string,
  ): PreparedRouteAttempt {
    const routeRequest = <T extends Parameters<LlmMesh['generate']>[0]>(request: T): T => ({
      ...request,
      providerId: target.providerId as ProviderId,
      modelId: target.modelId,
      auth: { material: acquisition.material, descriptor: acquisition.descriptor },
      ...(target.effort
        ? { reasoning: { ...request.reasoning, effort: target.effort as never } }
        : {}),
    });
    let terminal = false;
    const record = async (classification: RouteFailureClassification) => {
      if (terminal) return;
      terminal = true;
      const account = this.accountsMap.get(acquisition.lease.accountId);
      if (account && classification.reason === 'auth-failed') account.status = 'reauth_required';
      if (account && classification.reason === 'rate-limited') account.status = 'cooldown';
      await acquisition.recordOutcome({
        status: classification.reason === 'auth-failed' ? 'auth_failed'
          : classification.reason === 'rate-limited' ? 'rate_limited' : 'failed',
        ...(classification.retryAfterMs !== undefined
          ? { retryAfterMs: classification.retryAfterMs }
          : {}),
      });
    };
    return {
      attemptRef,
      generate: (request) => runtime.generate(routeRequest(request)),
      stream: (request) => runtime.stream(routeRequest(request)),
      recordOutcome: record,
      async markCommitted() {},
      complete: async () => {
        if (terminal) return;
        terminal = true;
        await acquisition.recordOutcome({ status: 'success' });
      },
      releaseCancelled: async () => {
        if (terminal) return;
        terminal = true;
        await this.release(acquisition);
      },
    };
  }

  private diagnosticAccountRef(accountId: string): string {
    let hash = 2_166_136_261;
    for (const char of accountId) hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619);
    return `acct_${(hash >>> 0).toString(36)}`;
  }

  // ── Internal — never exposed to h2a ───────────────────────────────────────
  private async completeEnrollment(_input: CompleteEnrollmentInput): Promise<void> {
    // Handled internally by EnrollmentProvider.complete()
  }

  private async refreshToken(input: RefreshInput): Promise<PreparedCredential> {
    // P0-5: Single-flight refresh map to prevent parallel refresh races
    if (this.refreshInFlight.has(input.accountId)) {
      return this.refreshInFlight.get(input.accountId)!;
    }

    const refreshPromise = (async () => {
      try {
        const account = this.accountsMap.get(input.accountId);
        const providerId = account?.transportProviderId ?? 'cloud-code';
        const provider = this.providers.get(providerId);

        if (!provider) {
          throw new Error(`No provider registered for refresh: ${providerId}`);
        }

        return await provider.refresh(input);
      } finally {
        this.refreshInFlight.delete(input.accountId);
      }
    })();

    this.refreshInFlight.set(input.accountId, refreshPromise);
    return refreshPromise;
  }

  private async persistCredential(
    pub: AccountPublic,
    env: CredentialEnvelope,
    account: AccountTransportAccount,
  ): Promise<void> {
    const {
      accessToken: _accessToken,
      refreshToken: _refreshToken,
      expiresAt: _expiresAt,
      ...persistedAccount
    } = account;
    const publicRecord: AccountPublicRecord = { ...pub, account: persistedAccount };
    await this.keyring.setSecret(
      `sentropic-llm-mesh:${pub.accountId}:public`,
      JSON.stringify(publicRecord),
    );
    await this.keyring.setSecret(`sentropic-llm-mesh:${pub.accountId}:envelope`, JSON.stringify(env));
    const rawIndex = await this.keyring.getSecret(LocalAccountTransportService.accountIndexKey);
    const accountIds = this.parseAccountIndex(rawIndex);
    if (!accountIds.includes(pub.accountId)) {
      accountIds.push(pub.accountId);
      await this.keyring.setSecret(
        LocalAccountTransportService.accountIndexKey,
        JSON.stringify(accountIds),
      );
    }
  }

  private parseAccountIndex(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private async restorePersistedAccounts(): Promise<void> {
    const rawIndex = await this.keyring.getSecret(LocalAccountTransportService.accountIndexKey);
    for (const accountId of this.parseAccountIndex(rawIndex)) {
      if (this.accountsMap.has(accountId)) continue;
      const publicRaw = await this.keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`);
      const envelopeRaw = await this.keyring.getSecret(`sentropic-llm-mesh:${accountId}:envelope`);
      if (!publicRaw || !envelopeRaw) continue;
      try {
        const publicRecord = JSON.parse(publicRaw) as Partial<AccountPublicRecord>;
        const envelope = JSON.parse(envelopeRaw) as CredentialEnvelope;
        if (!publicRecord.account || envelope.accountId !== accountId) continue;
        this.registerAccount(
          {
            ...publicRecord.account,
            targetProviderId: publicRecord.account.transportProviderId === 'cloud-code'
              && publicRecord.account.targetProviderId === 'google'
              ? 'gemini'
              : publicRecord.account.targetProviderId,
            accessToken: envelope.accessToken,
            refreshToken: envelope.refreshToken,
            expiresAt: envelope.expiresAt,
          },
          envelope.authClientConfigVersion,
        );
      } catch {
        // Ignore incomplete/corrupt entries; another active account may still be usable.
      }
    }
  }

  private async markReauthRequired(accountId: string): Promise<void> {
    const account = this.accountsMap.get(accountId);
    if (account) {
      account.status = 'reauth_required';
    }
  }
}
