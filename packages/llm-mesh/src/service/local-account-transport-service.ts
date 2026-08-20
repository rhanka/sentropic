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
  removalBarrierRef?: string;
}

interface AccountRemovalTombstone {
  v: 1;
  accountId: string;
  ownerScopeRef: string;
  removedAt: string;
}

// Cloud Code does not currently return a per-account model inventory during
// enrollment. Advertise only the model proven executable by the live transport
// contract; explicit account.modelIds may override this after provider evidence.
const VERIFIED_CLOUD_CODE_MODEL_IDS = [
  'gemini-3.1-flash-lite',
  'claude-opus-4-6-thinking',
  'gemini-3.7-flash',
  'gemini-3.1-pro',
] as const;

const supportedModelIdsForAccount = (
  account: AccountTransportAccount,
): readonly string[] => {
  if (account.modelIds?.length) return account.modelIds;
  if (account.transportProviderId === 'cloud-code') {
    return VERIFIED_CLOUD_CODE_MODEL_IDS;
  }
  return listModelProfilesByProvider(account.targetProviderId as ProviderId)
    .map((profile) => profile.modelId);
};

export class LocalAccountTransportService {
  private static readonly accountIndexKey = 'sentropic-llm-mesh:accounts:index';
  private readonly coordinator: InMemoryAccountTransportCoordinator;
  private readonly accountsMap = new Map<string, AccountTransportAccount>();
  private readonly credentialVersions = new Map<string, string>();
  private readonly refreshInFlight = new Map<string, Promise<PreparedCredential>>();
  private readonly accountRemovalBarrierRefs = new Map<string, string>();
  private routeAttemptSequence = 0;

  constructor(
    private readonly keyring: KeyringAdapter,
    private readonly providers: Map<string, EnrollmentProvider>,
    private readonly configResolver: ConfigResolver,
    private readonly legacyAccountOwnerScopeRef?: string,
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
      const removalBarrierRef = await this.removalBarrierForEnrollment(
        res.accountId,
        res.ownerScope,
      );
      const now = new Date().toISOString();
      const account: AccountTransportAccount = {
        accountId: res.accountId,
        ownerScopeRef: res.ownerScope,
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
      this.registerAccount(
        account,
        res.credential.authClientConfigVersion,
        removalBarrierRef,
      );
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
      const removalBarrierRef = await this.removalBarrierForEnrollment(
        res.accountId,
        res.ownerScope,
      );
      const now = new Date().toISOString();
      // P0-4: Persist credentials obtained via device flow poll into keyring/accounts
      const account: AccountTransportAccount = {
        accountId: res.accountId,
        ownerScopeRef: res.ownerScope,
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
      this.registerAccount(
        account,
        res.credential.authClientConfigVersion,
        removalBarrierRef,
      );
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

  async listAccounts(ownerScope: string): Promise<readonly AccountPublic[]> {
    const scope = this.requireOwnerScope(ownerScope);
    await this.restorePersistedAccounts();
    const rawIndex = await this.keyring.getSecret(LocalAccountTransportService.accountIndexKey);
    const accounts: AccountPublic[] = [];
    for (const accountId of this.parseAccountIndex(rawIndex)) {
      const record = await this.readPublicRecord(accountId);
      if (
        !record
        || record.account.ownerScopeRef !== scope
        || await this.isPublicRecordRemoved(record)
      ) continue;
      accounts.push({
        accountId: record.accountId,
        ...(record.accountLabel ? { accountLabel: record.accountLabel } : {}),
        providerId: record.providerId,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }
    return accounts;
  }

  async removeAccount(
    accountId: string,
    ownerScope: string,
  ): Promise<{ accountId: string; removed: true }> {
    const scope = this.requireOwnerScope(ownerScope);
    await this.restorePersistedAccounts();
    const record = await this.readPublicRecord(accountId);
    const existingTombstone = await this.readRemovalTombstone(accountId);
    if (
      (!record && !existingTombstone)
      || (record && record.account.ownerScopeRef !== scope)
      || (existingTombstone && existingTombstone.ownerScopeRef !== scope)
    ) {
      throw new Error(`Account '${accountId}' not found`);
    }

    const existingBarrierStillApplies = existingTombstone
      && (!record || record.removalBarrierRef !== existingTombstone.removedAt);
    if (!existingBarrierStillApplies) {
      const tombstone: AccountRemovalTombstone = {
        v: 1,
        accountId,
        ownerScopeRef: scope,
        removedAt: this.nextRemovalTimestamp(existingTombstone?.removedAt),
      };
      await this.keyring.setSecret(this.removalKey(accountId), JSON.stringify(tombstone));
    }

    this.coordinator.removeAccount(accountId);
    this.accountsMap.delete(accountId);
    this.credentialVersions.delete(accountId);
    this.accountRemovalBarrierRefs.delete(accountId);
    await this.keyring.deleteSecret(`sentropic-llm-mesh:${accountId}:envelope`);
    await this.keyring.deleteSecret(`sentropic-llm-mesh:${accountId}:public`);
    return { accountId, removed: true };
  }

  // ── Account Registration for Coordinator ──────────────────────────────
  registerAccount(
    account: AccountTransportAccount,
    configVersion = 'v1.0.0',
    removalBarrierRef?: string,
  ): void {
    const executableAccount = this.coordinator.addAccount(account);
    this.accountsMap.set(account.accountId, executableAccount);
    this.credentialVersions.set(account.accountId, configVersion);
    if (removalBarrierRef) {
      this.accountRemovalBarrierRefs.set(account.accountId, removalBarrierRef);
    } else {
      this.accountRemovalBarrierRefs.delete(account.accountId);
    }
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

    const acquiredAccountId = acquisition.material.accountId ?? acquisition.lease.accountId;
    if (await this.isAccountRemoved(acquiredAccountId)) {
      await acquisition.release?.();
      throw new AccountTransportAcquireError(
        `Account ${acquiredAccountId} has been removed`,
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

          if (await this.isAccountRemoved(account.accountId)) {
            await acquisition.release?.();
            throw new AccountTransportAcquireError(
              `Account ${account.accountId} has been removed`,
              'no_active_account',
            );
          }

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
      listEligible: async (subject) => this.listRouteAccounts(subject),
      listDiagnostics: async (subject) => this.listRouteDiagnostics(subject),
      prepareAttempt: async (input) => {
        const acquisition = await this.acquire({
          accountId: input.accountRef,
          ownerScopeRef: input.subject.ownerScopeRef,
          ...(input.affinityRef ? { affinityKey: input.affinityRef } : {}),
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

  private async listRouteDiagnostics(
    subject: import('../routing-contracts.js').VerifiedRoutingSubject,
  ): Promise<readonly import('../routing-contracts.js').RouteAvailabilityDiagnostic[]> {
    await this.restorePersistedAccounts();
    const diagnostics: import('../routing-contracts.js').RouteAvailabilityDiagnostic[] = [];
    if ([...this.accountsMap.values()].some((account) =>
      account.transportProviderId === 'codex' && !account.ownerScopeRef)) {
      diagnostics.push({
        code: 'reenrollment-required',
        transportProviderId: 'codex',
        message: 'Codex enrollment must be renewed for owner-scoped routing',
      });
    }
    for (const account of this.accountsMap.values()) {
      if (account.ownerScopeRef !== subject.ownerScopeRef || account.status !== 'reauth_required') {
        continue;
      }
      diagnostics.push({
        code: 'reauth-required',
        transportProviderId: account.transportProviderId,
        message: `${account.transportProviderId} authentication must be renewed`,
      });
    }
    return diagnostics;
  }

  private async listRouteAccounts(
    subject: import('../routing-contracts.js').VerifiedRoutingSubject,
  ): Promise<readonly EligibleAccountDescriptor[]> {
    await this.restorePersistedAccounts();
    const recovered = this.coordinator.refreshLifecycle();
    await Promise.all(recovered.flatMap((accountId) => {
      const account = this.accountsMap.get(accountId);
      return account ? [this.persistAccountState(account)] : [];
    }));
    return [...this.accountsMap.values()]
      .filter((account) => account.ownerScopeRef === subject.ownerScopeRef)
      .map((account) => ({
      accountRef: account.accountId,
      diagnosticAccountRef: this.diagnosticAccountRef(account.accountId),
      targetProviderId: account.targetProviderId,
      transportProviderId: account.transportProviderId,
      supportedModelIds: supportedModelIdsForAccount(account),
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
      await acquisition.recordOutcome({
        status: classification.reason === 'auth-failed' ? 'auth_failed'
          : classification.reason === 'rate-limited' ? 'rate_limited' : 'failed',
        ...(classification.retryAfterMs !== undefined
          ? { retryAfterMs: classification.retryAfterMs }
          : {}),
      });
      const account = this.accountsMap.get(acquisition.lease.accountId);
      if (account) await this.persistAccountState(account);
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
    const removalBarrierRef = this.accountRemovalBarrierRefs.get(pub.accountId);
    if (await this.isAccountRemoved(pub.accountId)) {
      throw new Error(`Account '${pub.accountId}' has been removed`);
    }
    const {
      accessToken: _accessToken,
      refreshToken: _refreshToken,
      expiresAt: _expiresAt,
      ...persistedAccount
    } = account;
    const publicRecord: AccountPublicRecord = {
      ...pub,
      account: persistedAccount,
      ...(removalBarrierRef ? { removalBarrierRef } : {}),
    };
    await this.keyring.setSecret(`sentropic-llm-mesh:${pub.accountId}:envelope`, JSON.stringify(env));
    await this.keyring.setSecret(
      `sentropic-llm-mesh:${pub.accountId}:public`,
      JSON.stringify(publicRecord),
    );
    if (await this.isAccountRemoved(pub.accountId)) {
      await this.cleanupRemovedPersistence(pub.accountId, removalBarrierRef);
      throw new Error(`Account '${pub.accountId}' has been removed`);
    }
    const rawIndex = await this.keyring.getSecret(LocalAccountTransportService.accountIndexKey);
    const accountIds = this.parseAccountIndex(rawIndex);
    if (!accountIds.includes(pub.accountId)) {
      accountIds.push(pub.accountId);
      await this.keyring.setSecret(
        LocalAccountTransportService.accountIndexKey,
        JSON.stringify(accountIds),
      );
    }
    if (await this.isAccountRemoved(pub.accountId)) {
      await this.cleanupRemovedPersistence(pub.accountId, removalBarrierRef);
      throw new Error(`Account '${pub.accountId}' has been removed`);
    }
  }

  private async persistAccountState(account: AccountTransportAccount): Promise<void> {
    if (await this.isAccountRemoved(account.accountId)) return;
    const key = `sentropic-llm-mesh:${account.accountId}:public`;
    const raw = await this.keyring.getSecret(key);
    if (!raw) return;
    try {
      const current = JSON.parse(raw) as Partial<AccountPublicRecord>;
      if (!current.account) return;
      const {
        accessToken: _accessToken,
        refreshToken: _refreshToken,
        expiresAt: _expiresAt,
        ...persistedAccount
      } = account;
      if (await this.isAccountRemoved(account.accountId)) return;
      await this.keyring.setSecret(key, JSON.stringify({
        ...current,
        status: account.status ?? current.status,
        updatedAt: new Date().toISOString(),
        account: persistedAccount,
      }));
    } catch {
      // A corrupt public record remains fail-closed and is not overwritten.
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

  private requireOwnerScope(ownerScope: string): string {
    const scope = ownerScope.trim();
    if (!scope) throw new Error('ownerScope is required');
    return scope;
  }

  private removalKey(accountId: string): string {
    return `sentropic-llm-mesh:${accountId}:removed`;
  }

  private async readRemovalTombstone(accountId: string): Promise<AccountRemovalTombstone | null> {
    const raw = await this.keyring.getSecret(this.removalKey(accountId));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<AccountRemovalTombstone>;
      if (
        value.v !== 1
        || value.accountId !== accountId
        || typeof value.ownerScopeRef !== 'string'
        || !value.ownerScopeRef
        || typeof value.removedAt !== 'string'
      ) return null;
      return value as AccountRemovalTombstone;
    } catch {
      return null;
    }
  }

  private async isAccountRemoved(accountId: string): Promise<boolean> {
    const tombstone = await this.readRemovalTombstone(accountId);
    if (!tombstone) return false;
    return this.accountRemovalBarrierRefs.get(accountId) !== tombstone.removedAt;
  }

  private async isPublicRecordRemoved(record: AccountPublicRecord): Promise<boolean> {
    const tombstone = await this.readRemovalTombstone(record.accountId);
    if (!tombstone) return false;
    return record.account.ownerScopeRef !== tombstone.ownerScopeRef
      || record.removalBarrierRef !== tombstone.removedAt;
  }

  private async removalBarrierForEnrollment(
    accountId: string,
    ownerScopeRef: string,
  ): Promise<string | undefined> {
    const existing = await this.readPublicRecord(accountId);
    if (existing && existing.account.ownerScopeRef !== ownerScopeRef) {
      throw new Error(`Account '${accountId}' belongs to another owner scope`);
    }
    const tombstone = await this.readRemovalTombstone(accountId);
    if (!tombstone) return undefined;
    if (tombstone.ownerScopeRef !== ownerScopeRef) {
      throw new Error(`Account '${accountId}' belongs to another owner scope`);
    }
    return tombstone.removedAt;
  }

  private nextRemovalTimestamp(previous?: string): string {
    const previousMs = previous ? Date.parse(previous) : Number.NaN;
    return new Date(Math.max(Date.now(), Number.isFinite(previousMs) ? previousMs + 1 : 0))
      .toISOString();
  }

  private async cleanupRemovedPersistence(
    accountId: string,
    attemptedBarrierRef?: string,
  ): Promise<void> {
    const current = await this.readPublicRecord(accountId);
    if (current && !(await this.isPublicRecordRemoved(current))) return;
    if (!current || current.removalBarrierRef === attemptedBarrierRef) {
      await this.keyring.deleteSecret(`sentropic-llm-mesh:${accountId}:envelope`);
      await this.keyring.deleteSecret(`sentropic-llm-mesh:${accountId}:public`);
    }
  }

  private async readPublicRecord(accountId: string): Promise<AccountPublicRecord | null> {
    const raw = await this.keyring.getSecret(`sentropic-llm-mesh:${accountId}:public`);
    if (!raw) return null;
    try {
      const record = JSON.parse(raw) as Partial<AccountPublicRecord>;
      if (
        record.accountId !== accountId
        || typeof record.providerId !== 'string'
        || typeof record.status !== 'string'
        || typeof record.createdAt !== 'string'
        || typeof record.updatedAt !== 'string'
        || !record.account
      ) return null;
      return record as AccountPublicRecord;
    } catch {
      return null;
    }
  }

  private async restorePersistedAccounts(): Promise<void> {
    for (const accountId of [...this.accountsMap.keys()]) {
      if (!(await this.isAccountRemoved(accountId))) continue;
      this.coordinator.removeAccount(accountId);
      this.accountsMap.delete(accountId);
      this.credentialVersions.delete(accountId);
      this.accountRemovalBarrierRefs.delete(accountId);
    }
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
        const tombstone = await this.readRemovalTombstone(accountId);
        if (tombstone && (
          publicRecord.account.ownerScopeRef !== tombstone.ownerScopeRef
          || publicRecord.removalBarrierRef !== tombstone.removedAt
        )) continue;
        const migrateLegacyOwner = !publicRecord.account.ownerScopeRef
          && publicRecord.account.transportProviderId === 'cloud-code'
          && this.legacyAccountOwnerScopeRef;
        const restoredAccount = {
          ...publicRecord.account,
          ...(migrateLegacyOwner
            ? { ownerScopeRef: this.legacyAccountOwnerScopeRef }
            : {}),
        };
        this.registerAccount(
          {
            ...restoredAccount,
            targetProviderId: publicRecord.account.transportProviderId === 'cloud-code'
              && publicRecord.account.targetProviderId === 'google'
              ? 'gemini'
              : publicRecord.account.targetProviderId,
            accessToken: envelope.accessToken,
            refreshToken: envelope.refreshToken,
            expiresAt: envelope.expiresAt,
          },
          envelope.authClientConfigVersion,
          publicRecord.removalBarrierRef,
        );
        if (migrateLegacyOwner && restoredAccount.ownerScopeRef) {
          await this.keyring.setSecret(
            `sentropic-llm-mesh:${accountId}:public`,
            JSON.stringify({ ...publicRecord, account: restoredAccount }),
          );
        }
      } catch {
        // Ignore incomplete/corrupt entries; another active account may still be usable.
      }
    }
  }

  private async markReauthRequired(accountId: string): Promise<void> {
    const account = this.accountsMap.get(accountId);
    if (account) {
      account.status = 'reauth_required';
      await this.persistAccountState(account);
    }
  }
}
