/**
 * Gateway pool ports (spec §4). The pool STATE is gateway-owned: a
 * control-plane DB for metadata/leases/reservations/quota/cooldown/audit and a
 * KMS/envelope-encrypted secret store for refresh/access bundles. v0 ships
 * INTERFACES + minimal stubs only — no DB, no KMS wiring.
 *
 * Account selection reuses Layer-A (`@sentropic/llm-mesh`): the gateway pool
 * holds `AccountTransportAccount` rows and selects via an
 * `AccountTransportCoordinator` (its `acquire()` is the public selection +
 * sticky-lease surface; the prior account-transport spec's hard constraints
 * apply — short tx, `FOR UPDATE SKIP LOCKED`, NO lock during streams, explicit
 * non-secret affinity, NO silent rebind). The redacted descriptor — never the
 * secret — is what flows into hooks/logs/traces.
 */

import type {
  AccountTransportAccount,
  AccountTransportAcquireInput,
  AccountTransportAcquisition,
  AuthDescriptor,
  SecretAuthMaterial,
} from '@sentropic/llm-mesh';

import type { AuthorizationGrant } from './authz.js';
import type { CostContext } from './cost-context.js';

/**
 * Selection request the gateway builds from the verified caller + parsed
 * provider/model. Extends the Layer-A acquire input with the gateway-owned
 * financial context and (gated) cross-user authorization grant.
 */
export interface PoolSelectionRequest extends AccountTransportAcquireInput {
  readonly cost: CostContext;
  /**
   * Cross-user authorization grant (spec §7 D0). v0 = always absent
   * (personal-passthrough). When the kill switch is OFF the gateway MUST
   * reject any request that would require a grant.
   */
  readonly authorization?: AuthorizationGrant;
}

/**
 * Result of selecting + leasing a pooled account. Wraps the Layer-A PUBLIC
 * acquisition `AccountTransportAcquisition` (the `acquire()` result: material +
 * descriptor + lease + reservation + recordOutcome) — NOT the private
 * `selectAccount` (which is an internal method on the in-memory coordinator,
 * not exported). The gateway attaches the (gated) `AuthorizationGrant` here
 * (spec §7 D0: `AuthzMode` + responsible `ProviderIdentity`) so every cross-user
 * dispatch is traceable. v0 personal-passthrough leaves `authorization` absent
 * (caller == provider, kill switch OFF — carried-but-not-enforced).
 */
export interface PoolSelection {
  readonly acquisition: AccountTransportAcquisition;
  readonly authorization?: AuthorizationGrant;
}

/**
 * A model the pool can serve, for `/v1/models` (spec §3). Carries ONLY the
 * model id + owning provider — NEVER account ids/tokens.
 */
export interface ModelCatalogEntry {
  readonly id: string;
  readonly ownedBy: string;
}

/**
 * PoolStatePort — gateway-owned pool lifecycle. v0 stub backs onto an
 * in-memory Layer-A coordinator; Lot 2+ backs onto the control-plane DB.
 */
export interface PoolStatePort {
  /** Snapshot the eligible accounts for a selection (DB read in Lot 2+). */
  listEligibleAccounts(
    request: PoolSelectionRequest,
  ): Promise<readonly AccountTransportAccount[]>;
  /** Select + lease one account (short tx; NO silent rebind). */
  select(request: PoolSelectionRequest): Promise<PoolSelection>;
  /**
   * The distinct models the caller's pool can serve (spec §3 — `/v1/models`,
   * filtered by caller/pool policy). NEVER exposes account ids/tokens.
   */
  snapshotModels(cost: CostContext): Promise<readonly ModelCatalogEntry[]>;
}

/**
 * AuthResolver — gateway-owned (spec §4). Resolves a selected pooled
 * account's executable `SecretAuthMaterial` from the secret store, refreshing
 * under lock if expired. Refresh is GATEWAY-owned + coordinated, NEVER
 * delegated to llm-mesh. Hooks/logs receive the redacted `AuthDescriptor`, the
 * resolver returns the executable material to the dispatch path only.
 */
export interface AuthResolver {
  resolve(selection: PoolSelection): Promise<{
    readonly material: SecretAuthMaterial;
    readonly descriptor: AuthDescriptor;
  }>;
}
