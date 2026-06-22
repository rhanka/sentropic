/**
 * Cross-user authorization model — TYPES ONLY (spec §7 OWNER D0,
 * owner-ratified 2026-06-21). NOT enforced in v0 (personal-passthrough,
 * caller == provider). These types exist so the lease / account-selection
 * signature can already CARRY the authorization mode + the responsible
 * provider identity, making every future cross-user dispatch traceable to a
 * responsible provider session. Enforcement is gated behind the cross-user
 * kill switch (`GatewayConfig.crossUserPoolEnabled`, default OFF).
 *
 * Invariant (spec §7): when a user supplies their account, they take on a
 * FULL SESSION and the associated RESPONSIBILITIES — not an anonymous credit
 * dump. The provider-identity below is the responsible party.
 */

/**
 * The three authorization modes that govern how a third party may use an
 * account supplied by a provider (spec §7 D0):
 *  - `direct`            — provider pre-authorizes; requests run without per-request gating.
 *  - `explicit-validation` — each/batched third-party request needs the provider's explicit approval first.
 *  - `assisted`          — an assistant processes third-party requests on the provider's behalf (mediated, provider-accountable).
 */
export type AuthzMode = 'direct' | 'explicit-validation' | 'assisted';

/**
 * The responsible provider session a pooled account belongs to. Carried on
 * the lease + selection so every dispatch is traceable. v0 leaves this
 * undefined (personal-passthrough: caller == provider).
 */
export interface ProviderIdentity {
  readonly providerSubjectId: string;
  readonly providerLabel?: string;
  /** Tenant/org the responsible provider belongs to, when known. */
  readonly tenantId?: string;
}

/**
 * Authorization grant attached to a cross-user lease. v0 = always absent
 * (personal-passthrough). Gated behind the kill switch.
 */
export interface AuthorizationGrant {
  readonly mode: AuthzMode;
  readonly responsibleProvider: ProviderIdentity;
  /** For `explicit-validation`: the approval token/reference, if pre-collected. */
  readonly approvalRef?: string;
}
