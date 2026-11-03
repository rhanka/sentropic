// A4 composition-gaps bundle 1.2.0, domain `oauth_tenant_reads` (design
// a4-cm-gaps-r2 §6): sibling read interfaces over the frozen 1.0
// `OAuthTenantStore`. The frozen store gains no methods; durable backends and
// the doubles implement both, and typed access from a combined transaction
// goes through `oauthTenantStoreV1`, which fails closed on old backends.

import type { IdentityStores, OAuthTenantStore } from './ports.js';
import type { OAuthConsentRecord, ServiceClientBinding } from './types.js';
import type { IdentityTransactionV1 } from './custody.js';
import { IdentityCustodyErrorV1 } from './custody-errors.js';
import { assertIdentityTransactionActive } from '../storage/identity/custody-transaction-guards.js';

export interface OAuthConsentReadStoreV1 {
  /** Unfiltered by lifecycle state (r6 §4.3 finder convention). */
  findConsent(consentId: string): Promise<OAuthConsentRecord | null>;
  /**
   * The live consent for one grant key: among rows with exact
   * (userId, clientId, tenantId) and revokedAt === undefined, the newest by
   * grantedAt, ties broken by bytewise-descending consentId. Null when no
   * live row exists. This finder is expressly lifecycle-filtered.
   */
  findConsentForGrant(input: {
    readonly userId: string;
    readonly clientId: string;
    readonly tenantId: string;
  }): Promise<OAuthConsentRecord | null>;
  /** All consent rows of one user, any state, grantedAt ascending, then bytewise consentId ascending. */
  listConsentsForUser(userId: string): Promise<readonly OAuthConsentRecord[]>;
}

export interface ServiceClientReadStoreV1 {
  findServiceClientBinding(clientId: string): Promise<ServiceClientBinding | null>;
}

export type OAuthTenantStoreV1 = OAuthTenantStore & OAuthConsentReadStoreV1 & ServiceClientReadStoreV1;

export interface IdentityStoresOauthV1 {
  readonly oauth: OAuthTenantStoreV1;
}

const OAUTH_READ_METHODS = [
  'findConsent',
  'findConsentForGrant',
  'listConsentsForUser',
  'findServiceClientBinding',
] as const;

/**
 * Typed access from a store bundle; fails closed on backends that predate the
 * 1.2.0 read surface. The cast stays inside the accessor: callers never see
 * it, and a store missing any read method refuses
 * `identity_contract_unavailable`.
 */
export function oauthTenantStoreV1FromStores(stores: IdentityStores): OAuthTenantStoreV1 {
  const oauth = stores.oauth as Partial<OAuthTenantStoreV1>;
  for (const method of OAUTH_READ_METHODS) {
    if (typeof oauth[method] !== 'function') throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  }
  return oauth as OAuthTenantStoreV1;
}

/**
 * Typed access from a combined transaction. Expired or foreign handles
 * (anything not registered as an active identity transaction) refuse
 * `identity_transaction_unbound` before any query, then the store feature
 * check applies as in `oauthTenantStoreV1FromStores`.
 */
export function oauthTenantStoreV1<H>(tx: IdentityTransactionV1<H>): OAuthTenantStoreV1 {
  assertIdentityTransactionActive(tx, false);
  return oauthTenantStoreV1FromStores(tx.stores);
}
