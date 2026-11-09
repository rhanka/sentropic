/**
 * Reauth alert port (Lot 1, owner decision D4).
 *
 * The custodian never talks to a human directly: when an account flips to
 * `reauth_required`, it emits a secret-free event through the configured
 * {@link ReauthAlertSink}. The host (cluster gateway operator) forwards the
 * event to the conductor over h2a and gates an owner browser re-auth.
 *
 * The event carries a diagnostic account reference, never the raw account
 * id and never any token material.
 */
export type ReauthAlertReason = 'refresh-failed' | 'expired-no-grant';

export interface ReauthAlertEvent {
  /** Canonical ISO instant the flip was observed. */
  at: string;
  ownerScopeRef: string;
  transportProviderId: string;
  /** Diagnostic hash of the account id (`acct_<base36>`); never the raw id. */
  accountRef: string;
  /** Canonical ISO expiry when the credential expired in the past. */
  expiredAt?: string;
  reason: ReauthAlertReason;
}

export interface ReauthAlertSink {
  notifyReauthRequired(event: ReauthAlertEvent): Promise<void> | void;
}
