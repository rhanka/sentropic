// A2.0b custody errors: one typed error for every new failure. Messages are
// fixed by code; they never interpolate SQL parameters, ids, emails, digests,
// tokens, provider subjects or custody material.

export type IdentityCustodyErrorCodeV1 =
  | 'identity_contract_unavailable'
  | 'identity_material_invalid'
  | 'identity_material_missing'
  | 'identity_record_conflict'
  | 'identity_subject_retired'
  | 'webauthn_credential_conflict'
  | 'webauthn_counter_rejected'
  | 'webauthn_credential_stale'
  | 'proof_state_conflict'
  | 'proof_binding_mismatch'
  | 'login_binding_mismatch'
  | 'login_refresh_conflict'
  | 'social_subject_conflict'
  | 'identity_import_conflict'
  | 'identity_import_invalid'
  | 'identity_transaction_unbound'
  | 'identity_transaction_indeterminate'
  | 'identity_cascade_participant_missing'
  | 'identity_cascade_step_failed'
  | 'identity_cascade_diagnostic_failed'
  | 'identity_delivery_claim_conflict'
  | 'identity_revocation_custody_missing'
  | 'identity_revocation_custody_invalid'
  | 'identity_orphan_detected'
  | 'identity_operation_conflict';

const FIXED_MESSAGES: Readonly<Record<IdentityCustodyErrorCodeV1, string>> = {
  identity_contract_unavailable: 'Identity custody contract is unavailable for this composition',
  identity_material_invalid: 'Identity material is invalid',
  identity_material_missing: 'Identity material is missing for this authentication',
  identity_record_conflict: 'Identity record conflicts with stored material',
  identity_subject_retired: 'Identity subject is retired',
  webauthn_credential_conflict: 'WebAuthn credential id is already registered',
  webauthn_counter_rejected: 'WebAuthn counter transition is rejected',
  webauthn_credential_stale: 'WebAuthn credential snapshot is stale',
  proof_state_conflict: 'Single-use proof revision conflicts with stored state',
  proof_binding_mismatch: 'Single-use proof binding does not match',
  login_binding_mismatch: 'Login binding does not match stored session material',
  login_refresh_conflict: 'Refresh token rotation conflicts with stored material',
  social_subject_conflict: 'Social subject is already linked to a stored account',
  identity_import_conflict: 'Import row conflicts with stored material',
  identity_import_invalid: 'Import row is invalid',
  identity_transaction_unbound: 'Identity store cannot join the active transaction',
  identity_transaction_indeterminate: 'Identity transaction outcome is indeterminate',
  identity_cascade_participant_missing: 'Required deletion participant is missing',
  identity_cascade_step_failed: 'Required deletion step failed',
  identity_cascade_diagnostic_failed: 'Deletion diagnostic persistence failed',
  identity_delivery_claim_conflict: 'Delivery claim is superseded or expired',
  identity_revocation_custody_missing: 'Revocation custody material is missing',
  identity_revocation_custody_invalid: 'Revocation custody material is invalid',
  identity_orphan_detected: 'Orphan identity or business reference detected',
  identity_operation_conflict: 'Operation id conflicts with a different command',
};

export class IdentityCustodyErrorV1 extends Error {
  readonly code: IdentityCustodyErrorCodeV1;
  readonly retryable: boolean;
  readonly operationId: string | undefined;

  constructor(
    code: IdentityCustodyErrorCodeV1,
    options?: { readonly retryable?: boolean; readonly operationId?: string },
  ) {
    super(FIXED_MESSAGES[code]);
    this.name = 'IdentityCustodyErrorV1';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.operationId = options?.operationId;
  }
}

/** Allowlisted frozen error codes that may cross the log boundary. */
const FROZEN_LOG_ALLOWLIST: ReadonlySet<string> = new Set([
  'identity_not_found',
  'identity_conflict',
  'account_not_active',
  'invalid_account_transition',
  'tenant_not_active',
  'tenant_offboard_blocked',
  'invalid_membership_transition',
  'invitation_invalid',
  'login_session_invalid',
  'device_code_invalid',
  'workspace_already_enrolled',
  'self_action_forbidden',
  'admin_user_protected',
  'proof_verification_failed',
]);

export interface ScrubbedIdentityError {
  readonly code: string;
  readonly reason?: string;
}

/**
 * Log-safe projection of any thrown value. Only allowlisted codes and fixed
 * custody messages survive; raw messages, causes, SQL parameters and driver
 * errors are never returned.
 */
export const scrubIdentityErrorForLog = (error: unknown): ScrubbedIdentityError => {
  if (error instanceof IdentityCustodyErrorV1) return { code: error.code };
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === 'string' && FROZEN_LOG_ALLOWLIST.has(code)) {
      const reason = (error as { readonly reason?: unknown }).reason;
      return typeof reason === 'string' ? { code, reason } : { code };
    }
  }
  return { code: 'internal' };
};
