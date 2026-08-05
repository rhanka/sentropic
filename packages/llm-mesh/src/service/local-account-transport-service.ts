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

export class LocalAccountTransportService {
  private readonly coordinator: InMemoryAccountTransportCoordinator;
  private readonly accountsMap = new Map<string, AccountTransportAccount>();
  private readonly credentialVersions = new Map<string, string>();
  private readonly refreshInFlight = new Map<string, Promise<PreparedCredential>>();

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
    if (!provider || !('waitForCallback' in provider) || typeof (provider as any).waitForCallback !== 'function') {
      throw new Error("No enrollment provider with 'waitForCallback' registered");
    }
    const res = await (provider as any).waitForCallback(enrollmentId);
    return { accountId: res.accountId, label: res.label };
  }

  async pollForCompletion(enrollmentId: string): Promise<{ accountId: string; label: string }> {
    const provider = this.providers.get('codex');
    if (!provider || !('pollForCompletion' in provider) || typeof (provider as any).pollForCompletion !== 'function') {
      throw new Error("No enrollment provider with 'pollForCompletion' registered");
    }
    const res = await (provider as any).pollForCompletion(enrollmentId);
    if (res.credential) {
      // P0-4: Persist credentials obtained via device flow poll into keyring/accounts
      this.registerAccount({
        accountId: res.accountId,
        targetProviderId: 'codex',
        transportProviderId: 'codex',
        accessToken: res.credential.accessToken,
        refreshToken: res.credential.refreshToken,
        expiresAt: res.credential.expiresAt,
        status: 'active',
      });
      await this.persistCredential(
        {
          accountId: res.accountId,
          accountLabel: res.label,
          providerId: 'codex',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          accountId: res.accountId,
          accessToken: res.credential.accessToken,
          refreshToken: res.credential.refreshToken,
          expiresAt: res.credential.expiresAt,
          authClientConfigVersion: res.credential.authClientConfigVersion,
        },
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
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
              authClientConfigVersion: refreshed.authClientConfigVersion,
            },
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

  async release(_acquisition: AccountTransportAcquisition): Promise<void> {
    // Q2B abort -> release reservation without recording an outcome / zero account impact
    return;
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
  ): Promise<void> {
    await this.keyring.setSecret(`sentropic-llm-mesh:${pub.accountId}:public`, JSON.stringify(pub));
    await this.keyring.setSecret(`sentropic-llm-mesh:${pub.accountId}:envelope`, JSON.stringify(env));
  }

  private async markReauthRequired(accountId: string): Promise<void> {
    const account = this.accountsMap.get(accountId);
    if (account) {
      account.status = 'reauth_required';
    }
  }
}
