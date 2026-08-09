import type {
  AccountTransportAuthMaterial,
  AccountTransportProviderId,
  AuthDescriptor,
} from './auth.js';
import type { ModelId, ProviderId } from './providers.js';

export type AccountTransportAccountStatus =
  | 'active'
  | 'cooldown'
  | 'reauth_required'
  | 'disabled';

export type AccountTransportOutcomeStatus =
  | 'success'
  | 'failed'
  | 'rate_limited'
  | 'auth_failed';

export interface AccountTransportAccount {
  accountId: string;
  ownerScopeRef?: string;
  accountLabel?: string | null;
  targetProviderId: ProviderId | (string & {});
  transportProviderId: AccountTransportProviderId | (string & {});
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  status?: AccountTransportAccountStatus;
  modelIds?: readonly (ModelId | (string & {}))[];
  priority?: number;
  weight?: number;
  cooldownUntil?: Date | string | null;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
  enrollmentCompletedAt?: string;
}

export interface AccountTransportAcquireInput {
  /** Mesh-internal exact candidate binding; never sourced from gateway ingress. */
  accountId?: string;
  ownerScopeRef?: string;
  targetProviderId: ProviderId | (string & {});
  transportProviderId: AccountTransportProviderId | (string & {});
  modelId?: ModelId | (string & {}) | null;
  workspaceId?: string | null;
  userId?: string | null;
  affinityKey?: string | null;
  requestId?: string | null;
  reservationTtlMs?: number;
  now?: Date | string | number;
  metadata?: Record<string, unknown>;
}

export interface AccountTransportReservation {
  reservationId: string;
  accountId: string;
  leaseId: string;
  expiresAt: string;
}

export interface AccountTransportLease {
  leaseId: string;
  accountId: string;
  affinityKey?: string | null;
  stableSessionId: string;
  createdAt: string;
}

export interface AccountTransportOutcome {
  status: AccountTransportOutcomeStatus;
  requestId?: string | null;
  providerStatusCode?: number;
  retryAfterMs?: number | null;
  quota?: Record<string, unknown>;
  errorCode?: string | null;
  finishedAt?: Date | string | number;
}

export interface AccountTransportAcquisition {
  material: AccountTransportAuthMaterial;
  descriptor: AuthDescriptor;
  lease: AccountTransportLease;
  reservation: AccountTransportReservation;
  runtime: {
    stableSessionId: string;
    headers?: Record<string, string>;
    metadata?: Record<string, unknown>;
  };
  recordOutcome(outcome: AccountTransportOutcome): Promise<void>;
  /** Releases an unfinished reservation without changing account health. */
  release?(): Promise<void>;
}

/**
 * Coordinator that manages account selection, leasing, and cooldown lifecycle.
 * Implementations MUST expire cooldowns (transition `cooldown → active` when
 * `cooldownUntil` has passed) atomically before eligibility checks in `acquire()`.
 */
export interface AccountTransportCoordinator {
  acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition>;
}

export class AccountTransportAcquireError extends Error {
  constructor(
    message: string,
    readonly code: 'no_account' | 'no_active_account',
  ) {
    super(message);
    this.name = 'AccountTransportAcquireError';
  }
}

interface StoredAccount extends AccountTransportAccount {
  status: AccountTransportAccountStatus;
  priority: number;
  weight: number;
  totalAcquisitions: number;
}

interface StoredLease extends AccountTransportLease {
  key?: string;
}

interface StoredReservation extends AccountTransportReservation {
  expiresAtMs: number;
}

const DEFAULT_RESERVATION_TTL_MS = 5 * 60 * 1000;
/** Default cooldown when rate_limited outcome has no retryAfterMs (60 seconds). */
const DEFAULT_COOLDOWN_MS = 60_000;

const toDate = (value: Date | string | number | undefined): Date => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }

  return new Date();
};

const normalizeOptional = (value: string | null | undefined): string => {
  return value ?? '';
};

const buildLeaseKey = (input: AccountTransportAcquireInput): string | undefined => {
  if (!input.affinityKey) {
    return undefined;
  }

  return [
    normalizeOptional(input.ownerScopeRef),
    normalizeOptional(input.workspaceId),
    input.affinityKey,
    input.targetProviderId,
    input.transportProviderId,
    normalizeOptional(input.modelId),
  ].join('\u001f');
};

const isCooldownActive = (account: StoredAccount, now: Date): boolean => {
  if (account.status !== 'cooldown') {
    return false;
  }

  if (!account.cooldownUntil) {
    return true;
  }

  return new Date(account.cooldownUntil).getTime() > now.getTime();
};

const supportsModel = (
  account: StoredAccount,
  modelId: string | null | undefined,
): boolean => {
  return !account.modelIds?.length || !modelId || account.modelIds.includes(modelId);
};

const sanitizeIdPart = (value: string): string => {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48) || 'account';
};

export class InMemoryAccountTransportCoordinator implements AccountTransportCoordinator {
  private readonly accounts = new Map<string, StoredAccount>();
  private readonly leases = new Map<string, StoredLease>();
  private readonly reservations = new Map<string, StoredReservation>();
  private leaseSequence = 0;
  private reservationSequence = 0;

  constructor(accounts: readonly AccountTransportAccount[] = []) {
    for (const account of accounts) {
      this.addAccount(account);
    }
  }

  addAccount(account: AccountTransportAccount): void {
    this.accounts.set(account.accountId, {
      ...account,
      status: account.status ?? 'active',
      priority: account.priority ?? 0,
      weight: Math.max(account.weight ?? 1, 1),
      totalAcquisitions: 0,
    });
  }

  async acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition> {
    const now = toDate(input.now);
    this.releaseExpiredReservations(now);
    this.expireCooldowns(now);

    const leaseKey = buildLeaseKey(input);
    const existingLease = leaseKey ? this.leases.get(leaseKey) : undefined;
    const account = existingLease
      ? this.getLeasedAccount(existingLease, input, now)
      : this.selectAccount(input, now);

    if (!account) {
      throw new AccountTransportAcquireError(
        `No active ${input.transportProviderId} account transport for ${input.targetProviderId}`,
        'no_active_account',
      );
    }

    const lease = existingLease ?? this.createLease(input, account, leaseKey, now);
    const reservation = this.createReservation(account.accountId, lease.leaseId, input, now);
    account.totalAcquisitions += 1;

    const material: AccountTransportAuthMaterial = {
      type: 'account-transport',
      provider: account.transportProviderId,
      accessToken: account.accessToken,
      ...(account.refreshToken ? { refreshToken: account.refreshToken } : {}),
      accountId: account.accountId,
      ...(account.accountLabel ? { accountLabel: account.accountLabel } : {}),
      ...(account.expiresAt ? { expiresAt: account.expiresAt } : {}),
      ...(account.headers ? { headers: account.headers } : {}),
      metadata: {
        ...(account.metadata ?? {}),
        leaseId: lease.leaseId,
        stableSessionId: lease.stableSessionId,
      },
    };
    const descriptor: AuthDescriptor = {
      sourceType: 'account-transport',
      accountProviderId: account.transportProviderId,
      accountId: account.accountId,
      ...(account.accountLabel ? { accountLabel: account.accountLabel } : {}),
      ...(account.expiresAt ? { expiresAt: account.expiresAt } : {}),
      hasRefreshToken: Boolean(account.refreshToken),
      metadata: {
        leaseId: lease.leaseId,
        stableSessionId: lease.stableSessionId,
      },
    };

    let outcomeRecorded = false;
    return {
      material,
      descriptor,
      lease,
      reservation,
      runtime: {
        stableSessionId: lease.stableSessionId,
        ...(account.headers ? { headers: account.headers } : {}),
        metadata: {
          accountId: account.accountId,
          leaseId: lease.leaseId,
        },
      },
      recordOutcome: async (outcome) => {
        if (outcomeRecorded) {
          return;
        }
        outcomeRecorded = true;
        this.reservations.delete(reservation.reservationId);
        this.applyOutcome(account, outcome);
      },
      release: async () => {
        if (outcomeRecorded) return;
        outcomeRecorded = true;
        this.reservations.delete(reservation.reservationId);
      },
    };
  }

  private getLeasedAccount(
    lease: StoredLease,
    input: AccountTransportAcquireInput,
    now: Date,
  ): StoredAccount | undefined {
    const account = this.accounts.get(lease.accountId);
    if (!account) {
      return undefined;
    }

    return this.isEligible(account, input, now) ? account : undefined;
  }

  private selectAccount(
    input: AccountTransportAcquireInput,
    now: Date,
  ): StoredAccount | undefined {
    const candidates = [...this.accounts.values()]
      .filter((account) => this.isEligible(account, input, now))
      .sort((left, right) => {
        const enrollmentOrder = (Date.parse(right.enrollmentCompletedAt ?? '') || 0)
          - (Date.parse(left.enrollmentCompletedAt ?? '') || 0);
        if (enrollmentOrder !== 0) {
          return enrollmentOrder;
        }

        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }

        const leftLoad = this.countReservations(left.accountId) / left.weight;
        const rightLoad = this.countReservations(right.accountId) / right.weight;
        if (leftLoad !== rightLoad) {
          return leftLoad - rightLoad;
        }

        if (left.totalAcquisitions !== right.totalAcquisitions) {
          return left.totalAcquisitions - right.totalAcquisitions;
        }

        return left.accountId.localeCompare(right.accountId);
      });

    return candidates[0];
  }

  private isEligible(
    account: StoredAccount,
    input: AccountTransportAcquireInput,
    _now: Date,
  ): boolean {
    return (!input.accountId || account.accountId === input.accountId)
      && (input.ownerScopeRef
        ? account.ownerScopeRef === input.ownerScopeRef
        : account.ownerScopeRef === undefined)
      && account.targetProviderId === input.targetProviderId
      && account.transportProviderId === input.transportProviderId
      && account.status === 'active'
      && supportsModel(account, input.modelId);
  }

  private createLease(
    input: AccountTransportAcquireInput,
    account: StoredAccount,
    key: string | undefined,
    now: Date,
  ): StoredLease {
    this.leaseSequence += 1;
    const leaseId = `lease_${this.leaseSequence.toString(36)}`;
    const lease: StoredLease = {
      leaseId,
      accountId: account.accountId,
      affinityKey: input.affinityKey ?? null,
      stableSessionId: `acct_${sanitizeIdPart(account.accountId)}_${leaseId}`,
      createdAt: now.toISOString(),
      ...(key ? { key } : {}),
    };

    if (key) {
      this.leases.set(key, lease);
    }

    return lease;
  }

  private createReservation(
    accountId: string,
    leaseId: string,
    input: AccountTransportAcquireInput,
    now: Date,
  ): StoredReservation {
    this.reservationSequence += 1;
    const ttlMs = input.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
    const expiresAtMs = now.getTime() + ttlMs;
    const reservation: StoredReservation = {
      reservationId: input.requestId
        ? `reservation_${sanitizeIdPart(input.requestId)}`
        : `reservation_${this.reservationSequence.toString(36)}`,
      accountId,
      leaseId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
    this.reservations.set(reservation.reservationId, reservation);
    return reservation;
  }

  private countReservations(accountId: string): number {
    let count = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.accountId === accountId) {
        count += 1;
      }
    }
    return count;
  }

  private releaseExpiredReservations(now: Date): void {
    for (const reservation of this.reservations.values()) {
      if (reservation.expiresAtMs <= now.getTime()) {
        this.reservations.delete(reservation.reservationId);
      }
    }
  }

  private expireCooldowns(now: Date): void {
    for (const account of this.accounts.values()) {
      if (account.status === 'cooldown' && !isCooldownActive(account, now)) {
        account.status = 'active';
        account.cooldownUntil = undefined;
      }
    }
  }

  private applyOutcome(account: StoredAccount, outcome: AccountTransportOutcome): void {
    if (outcome.status === 'auth_failed') {
      account.status = 'reauth_required';
      return;
    }

    if (outcome.status === 'rate_limited') {
      account.status = 'cooldown';
      const retryMs = typeof outcome.retryAfterMs === 'number' && outcome.retryAfterMs > 0
        ? outcome.retryAfterMs
        : DEFAULT_COOLDOWN_MS;
      const finishedAt = toDate(outcome.finishedAt);
      account.cooldownUntil = new Date(finishedAt.getTime() + retryMs).toISOString();
    }
  }
}
