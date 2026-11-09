/**
 * Proactive custodian refresh policy (Lot 1).
 *
 * The custodian used to refresh only reactively, when an access token was
 * already expired at acquire time. This module decides when a mesh-managed
 * account must be renewed *before* expiry: inside a skew window computed
 * from the credential TTL (25 % of TTL remaining by default, at least
 * 10 minutes). A refresh failure flips the account to `reauth_required`
 * early, so the route diagnostics carry the reauth signal without waiting
 * for a business call to fail.
 *
 * Pure functions only: the service owns clocks, providers and persistence.
 */

export interface CustodianRefreshPolicy {
  /** Fraction of TTL remaining that opens the refresh window (0.25). */
  skewRatio: number;
  /** Floor for the refresh window in ms (600_000 = 10 min). */
  minSkewMs: number;
}

export const DEFAULT_CUSTODIAN_REFRESH_POLICY: CustodianRefreshPolicy = {
  skewRatio: 0.25,
  minSkewMs: 600_000,
};

export interface RefreshWindowInput {
  expiresAtMs: number;
  /** Credential issuance instant; NaN/undefined falls back to the floor window. */
  issuedAtMs?: number;
  nowMs: number;
}

/** Width of the proactive refresh window for a credential TTL. */
export function refreshSkewMs(
  ttlMs: number,
  policy: CustodianRefreshPolicy = DEFAULT_CUSTODIAN_REFRESH_POLICY,
): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return policy.minSkewMs;
  return Math.min(ttlMs, Math.max(policy.minSkewMs, ttlMs * policy.skewRatio));
}

/** True when the credential must be renewed now, before it expires. */
export function shouldRefreshProactively(
  input: RefreshWindowInput,
  policy: CustodianRefreshPolicy = DEFAULT_CUSTODIAN_REFRESH_POLICY,
): boolean {
  const { expiresAtMs, nowMs } = input;
  if (!Number.isFinite(expiresAtMs)) return false;
  if (expiresAtMs <= nowMs) return true;
  const issuedAtMs = input.issuedAtMs;
  const ttlMs = issuedAtMs !== undefined && Number.isFinite(issuedAtMs)
    ? expiresAtMs - issuedAtMs
    : Number.NaN;
  return expiresAtMs - nowMs <= refreshSkewMs(ttlMs, policy);
}

export type CustodianAccountAction =
  | 'refreshed'
  | 'refresh-failed-reauth'
  | 'refresh-deferred-retry'
  | 'expired-no-grant'
  | 'skipped-healthy'
  | 'skipped-external'
  | 'skipped-no-grant'
  | 'skipped-no-expiry'
  | 'already-reauth';

export interface CustodianAccountReport {
  /** Diagnostic hash of the account id; never the raw id, never a secret. */
  accountRef: string;
  transportProviderId: string;
  ownerScopeRef: string;
  action: CustodianAccountAction;
  readiness: 'ready' | 'reauth-required';
  expiredAt?: string;
}

export interface CustodianRefreshReport {
  at: string;
  checked: number;
  refreshed: number;
  reauthRequired: number;
  accounts: CustodianAccountReport[];
}
