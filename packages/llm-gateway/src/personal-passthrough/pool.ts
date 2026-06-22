/**
 * v0 personal-passthrough PoolStatePort + AuthResolver (spec §4).
 *
 * Selection reuses Layer-A: `AccountTransportCoordinator.acquire()` is the
 * public selection + sticky-lease surface. The gateway pool wraps it and adds:
 *   - CALLER-OWNED ACCOUNTS (B1, spec §7 personal-passthrough = caller==provider):
 *     llm-mesh's `acquire()` selects over EVERY account in its coordinator and
 *     ignores `userId`; its lease key excludes the caller. So the gateway, which
 *     is the only layer that knows account OWNERSHIP, enforces caller==provider
 *     MECHANICALLY: each pool account carries an OWNER (the enrolling caller's
 *     verified user id) and the gateway hands a given caller a coordinator built
 *     over ONLY that caller's accounts (`coordinatorFor`). A caller therefore
 *     cannot select, nor stick to, another caller's account — the coordinator it
 *     uses literally cannot see them. Deny-as-missing when the caller owns none.
 *   - the per-caller AFFINITY KEY: the gateway folds the verified caller id into
 *     the sticky `affinityKey` (llm-mesh's lease key omits the caller), so even
 *     within one coordinator a sticky lease is caller-partitioned (belt + braces).
 *   - the kill-switch guard (reject any cross-user grant while OFF);
 *   - the gateway-owned financial context (CostContext on the request).
 *
 * Sticky binding (spec §4): the coordinator keys the lease on
 * `workspaceId + affinityKey + targetProviderId + transportProviderId + modelId`
 * (`buildLeaseKey` in llm-mesh) and the gateway prefixes `affinityKey` with the
 * caller. Same caller+affinity -> SAME account; the coordinator does NOT silently
 * rebind a leased account (it only re-uses an eligible lease or selects fresh).
 *
 * The AuthResolver returns the executable material from the acquisition. Refresh
 * under lock is GATEWAY-owned (spec §4) — here, v0, the coordinator hands a
 * still-valid bundle; an injectable `RefreshFn` is the documented seam for the
 * KMS/refresh-under-lock path (not exercised by personal-passthrough fixtures).
 */

import type {
  AccountTransportCoordinator,
  AuthDescriptor,
  SecretAuthMaterial,
} from '@sentropic/llm-mesh';
import { InMemoryAccountTransportCoordinator } from '@sentropic/llm-mesh';

import type {
  AuthResolver,
  ModelCatalogEntry,
  PoolSelection,
  PoolSelectionRequest,
  PoolStatePort,
} from '../ports/pool.js';
import type { AccountTransportAccount } from '@sentropic/llm-mesh';
import type { CostContext } from '../ports/cost-context.js';
import { GatewayError } from '../router/errors.js';

/**
 * The gateway-owned OWNER of a pooled account = the verified user id of the
 * caller who enrolled it. Stored under the account `metadata.ownerUserId`
 * (gateway convention; llm-mesh ignores account metadata). An account WITHOUT an
 * owner is unowned and is NEVER selectable in personal-passthrough (deny by
 * default) — caller==provider requires a known owner.
 */
export const OWNER_METADATA_KEY = 'ownerUserId';

/** Read the gateway owner of a pool account (undefined when unowned). */
export const accountOwnerId = (account: AccountTransportAccount): string | undefined => {
  const owner = account.metadata?.[OWNER_METADATA_KEY];
  return typeof owner === 'string' && owner.length > 0 ? owner : undefined;
};

/**
 * Factory that builds a coordinator scoped to a SINGLE owner's accounts. The
 * default builds an in-memory coordinator over the owner-filtered subset, so a
 * caller's coordinator cannot see another caller's accounts. Production injects
 * a DB-backed factory (still owner-scoped). The gateway caches one coordinator
 * per owner so sticky leases persist across that owner's requests.
 */
export type CoordinatorFactory = (
  ownerUserId: string,
  ownedAccounts: readonly AccountTransportAccount[],
) => AccountTransportCoordinator;

const defaultCoordinatorFactory: CoordinatorFactory = (_ownerUserId, ownedAccounts) =>
  new InMemoryAccountTransportCoordinator(ownedAccounts);

export interface CoordinatorPoolStateOptions {
  /**
   * The full gateway account snapshot. Each account's OWNER (`metadata.ownerUserId`)
   * scopes it to one caller. v0 personal-passthrough = every account is owned by
   * the caller who enrolled it (caller==provider).
   */
  readonly accounts?: readonly AccountTransportAccount[];
  /**
   * Per-owner coordinator factory (spec §4). Default = in-memory over the
   * owner-filtered subset. The gateway calls it ONCE per owner and caches the
   * result so sticky leases survive across requests.
   */
  readonly coordinatorFactory?: CoordinatorFactory;
  /**
   * Kill switch (spec §7 D0). DEFAULT OFF. While OFF, ANY selection request
   * carrying an `authorization` grant is rejected — v0 personal-passthrough
   * carries no grant (caller == provider), so this only fires for a misrouted
   * cross-user request.
   */
  readonly crossUserPoolEnabled?: boolean;
}

export class CoordinatorPoolState implements PoolStatePort {
  private readonly accounts: readonly AccountTransportAccount[];
  private readonly coordinatorFactory: CoordinatorFactory;
  private readonly crossUserPoolEnabled: boolean;
  /** One coordinator per OWNER (caller), so sticky leases persist + can't cross callers. */
  private readonly coordinators = new Map<string, AccountTransportCoordinator>();

  constructor(options: CoordinatorPoolStateOptions) {
    this.accounts = options.accounts ?? [];
    this.coordinatorFactory = options.coordinatorFactory ?? defaultCoordinatorFactory;
    this.crossUserPoolEnabled = options.crossUserPoolEnabled ?? false;
  }

  /** The accounts OWNED by a given caller (B1 caller==provider filter). */
  private ownedBy(ownerUserId: string): readonly AccountTransportAccount[] {
    return this.accounts.filter((account) => accountOwnerId(account) === ownerUserId);
  }

  /** The owner-scoped coordinator for a caller (built once, then cached). */
  private coordinatorFor(ownerUserId: string): AccountTransportCoordinator {
    let coordinator = this.coordinators.get(ownerUserId);
    if (!coordinator) {
      coordinator = this.coordinatorFactory(ownerUserId, this.ownedBy(ownerUserId));
      this.coordinators.set(ownerUserId, coordinator);
    }
    return coordinator;
  }

  async listEligibleAccounts(
    request: PoolSelectionRequest,
  ): Promise<readonly AccountTransportAccount[]> {
    // B1: only the verified caller's OWN accounts are ever eligible.
    const owner = request.cost.principalId;
    return this.ownedBy(owner).filter(
      (account) =>
        account.targetProviderId === request.targetProviderId &&
        account.transportProviderId === request.transportProviderId &&
        (account.status ?? 'active') === 'active' &&
        (!account.modelIds?.length ||
          !request.modelId ||
          account.modelIds.includes(request.modelId)),
    );
  }

  async snapshotModels(cost: CostContext): Promise<readonly ModelCatalogEntry[]> {
    // Distinct models the CALLER'S OWN pool can serve (spec §3 — filtered by
    // caller/pool policy). Account ids/tokens are NEVER exposed — only model id +
    // owning target provider. B1: another caller's models never appear here.
    const seen = new Set<string>();
    const entries: ModelCatalogEntry[] = [];
    for (const account of this.ownedBy(cost.principalId)) {
      if ((account.status ?? 'active') !== 'active') {
        continue;
      }
      for (const modelId of account.modelIds ?? []) {
        if (seen.has(modelId)) {
          continue;
        }
        seen.add(modelId);
        entries.push({ id: modelId, ownedBy: String(account.targetProviderId) });
      }
    }
    return entries;
  }

  async select(request: PoolSelectionRequest): Promise<PoolSelection> {
    // Kill-switch guard (spec §7 D0): a grant-requiring request is cross-user;
    // reject it while the switch is OFF. v0 personal-passthrough has no grant.
    if (request.authorization && !this.crossUserPoolEnabled) {
      throw new GatewayError(
        'cross-user-disabled',
        'cross-user pooling is disabled (kill switch OFF)',
      );
    }

    // B1: the VERIFIED caller is the owner. Deny-as-missing when they own no
    // matching account — never fall through to another caller's pool.
    const owner = request.cost.principalId;
    if (!owner) {
      throw new GatewayError('caller-auth-failed', 'no verified caller identity');
    }
    const eligible = await this.listEligibleAccounts(request);
    if (eligible.length === 0) {
      throw new GatewayError(
        'no-eligible-account',
        'caller owns no eligible account in pool',
      );
    }

    // B1: per-caller AFFINITY KEY — llm-mesh's lease key omits the caller, so we
    // fold the verified owner into the affinity so the sticky lease is
    // caller-partitioned even inside one coordinator.
    const callerAffinity =
      request.affinityKey != null ? `${owner}${request.affinityKey}` : undefined;

    // Acquire over the caller's OWN coordinator (sticky lease; no silent rebind;
    // cannot see another caller's accounts).
    const coordinator = this.coordinatorFor(owner);
    const acquisition = await coordinator.acquire({
      targetProviderId: request.targetProviderId,
      transportProviderId: request.transportProviderId,
      ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
      ...(request.workspaceId !== undefined ? { workspaceId: request.workspaceId } : {}),
      // userId carried for audit; llm-mesh ignores it, the OWNER-scoped
      // coordinator + affinity key are what enforce caller==provider.
      userId: owner,
      ...(callerAffinity !== undefined ? { affinityKey: callerAffinity } : {}),
      ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
      ...(request.reservationTtlMs !== undefined
        ? { reservationTtlMs: request.reservationTtlMs }
        : {}),
      ...(request.now !== undefined ? { now: request.now } : {}),
      ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
    });

    return {
      acquisition,
      ...(request.authorization ? { authorization: request.authorization } : {}),
    };
  }
}

/**
 * Gateway-owned refresh seam (spec §4): given an expired-or-near-expiry
 * material, return a refreshed one under lock. v0 personal-passthrough does not
 * exercise refresh (the coordinator hands a valid bundle); production binds the
 * KMS/refresh-under-lock implementation here. Refresh is NEVER delegated to
 * llm-mesh.
 */
export type RefreshFn = (
  material: SecretAuthMaterial,
) => Promise<SecretAuthMaterial> | SecretAuthMaterial;

export interface PassthroughAuthResolverOptions {
  /** Optional gateway-owned refresh-under-lock. Default: identity (no refresh). */
  readonly refresh?: RefreshFn;
  /** Treat material as expired when `expiresAt` is at/under `now`. */
  readonly now?: () => number;
}

/**
 * Resolve the selected account's executable material from the acquisition.
 * Refreshes (gateway-owned) only when the material is expired AND a `refresh`
 * fn is configured. Returns the executable material + the REDACTED descriptor
 * (hooks/logs get the descriptor only).
 */
export class PassthroughAuthResolver implements AuthResolver {
  private readonly refresh?: RefreshFn;
  private readonly now: () => number;

  constructor(options: PassthroughAuthResolverOptions = {}) {
    if (options.refresh) {
      this.refresh = options.refresh;
    }
    this.now = options.now ?? (() => Date.now());
  }

  async resolve(selection: PoolSelection): Promise<{
    material: SecretAuthMaterial;
    descriptor: AuthDescriptor;
  }> {
    const { material, descriptor } = selection.acquisition;
    if (this.refresh && this.isExpired(descriptor)) {
      const refreshed = await this.refresh(material);
      return { material: refreshed, descriptor };
    }
    return { material, descriptor };
  }

  private isExpired(descriptor: AuthDescriptor): boolean {
    if (!descriptor.expiresAt) {
      return false;
    }
    const expiresAt = Date.parse(descriptor.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= this.now();
  }
}
