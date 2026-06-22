/**
 * v0 personal-passthrough PoolStatePort + AuthResolver (spec §4).
 *
 * Selection reuses Layer-A: `AccountTransportCoordinator.acquire()` is the
 * public selection + sticky-lease surface. The gateway pool wraps it and adds:
 *   - the kill-switch guard (reject any cross-user grant while OFF);
 *   - the gateway-owned financial context (CostContext on the request).
 *
 * Sticky binding (spec §4): the coordinator keys the lease on
 * `workspaceId + affinityKey + targetProviderId + transportProviderId + modelId`
 * (`buildLeaseKey` in llm-mesh). Same caller+affinity -> SAME account; the
 * coordinator does NOT silently rebind a leased account (it only re-uses an
 * eligible lease or selects fresh when none exists).
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

export interface CoordinatorPoolStateOptions {
  readonly coordinator: AccountTransportCoordinator;
  /**
   * Kill switch (spec §7 D0). DEFAULT OFF. While OFF, ANY selection request
   * carrying an `authorization` grant is rejected — v0 personal-passthrough
   * carries no grant (caller == provider), so this only fires for a misrouted
   * cross-user request.
   */
  readonly crossUserPoolEnabled?: boolean;
  /**
   * Optional eligible-account snapshot for `listEligibleAccounts` / `/v1/models`
   * filtering. The coordinator owns selection; this is a read-only view.
   */
  readonly accounts?: readonly AccountTransportAccount[];
}

export class CoordinatorPoolState implements PoolStatePort {
  private readonly coordinator: AccountTransportCoordinator;
  private readonly crossUserPoolEnabled: boolean;
  private readonly accounts: readonly AccountTransportAccount[];

  constructor(options: CoordinatorPoolStateOptions) {
    this.coordinator = options.coordinator;
    this.crossUserPoolEnabled = options.crossUserPoolEnabled ?? false;
    this.accounts = options.accounts ?? [];
  }

  async listEligibleAccounts(
    request: PoolSelectionRequest,
  ): Promise<readonly AccountTransportAccount[]> {
    return this.accounts.filter(
      (account) =>
        account.targetProviderId === request.targetProviderId &&
        account.transportProviderId === request.transportProviderId &&
        (account.status ?? 'active') === 'active' &&
        (!account.modelIds?.length ||
          !request.modelId ||
          account.modelIds.includes(request.modelId)),
    );
  }

  async snapshotModels(_cost: CostContext): Promise<readonly ModelCatalogEntry[]> {
    // Distinct models the personal pool can serve (spec §3). Account ids/tokens
    // are NEVER exposed — only model id + owning target provider.
    const seen = new Set<string>();
    const entries: ModelCatalogEntry[] = [];
    for (const account of this.accounts) {
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

    // Acquire over the personal pool (sticky lease; no silent rebind).
    const acquisition = await this.coordinator.acquire({
      targetProviderId: request.targetProviderId,
      transportProviderId: request.transportProviderId,
      ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
      ...(request.workspaceId !== undefined ? { workspaceId: request.workspaceId } : {}),
      ...(request.userId !== undefined ? { userId: request.userId } : {}),
      ...(request.affinityKey !== undefined ? { affinityKey: request.affinityKey } : {}),
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
