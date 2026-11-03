import type { IdentityAuthCompletionFlowV1, IdentityAuthRefusalV1 } from '../identity-contracts/custody-auth.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

export class IdentityAuthCompletionAbort extends Error {
  constructor(readonly refusal: IdentityAuthRefusalV1) { super('Authentication refused'); }
}
export const finishAuthCompletion = <T>(flow: IdentityAuthCompletionFlowV1, result: T): T => {
  const record = result as { verified?: boolean; valid?: boolean; success?: boolean } | null;
  const refused = ['registration', 'authentication'].includes(flow) ? record?.verified === false
    : ['magic_link', 'email_code'].includes(flow) ? record?.valid === false
      : ['magic_link_issue', 'email_code_issue'].includes(flow) ? record?.success === false
        : ['session_validate', 'session_refresh', 'credential_rename'].includes(flow) ? result === null
          : ['credential_revoke', 'social_unlink'].includes(flow) ? result === false : false;
  if (refused) throw new IdentityAuthCompletionAbort({ flow, result } as IdentityAuthRefusalV1);
  return result;
};
export const refuseWebAuthn = (flow: 'registration' | 'authentication', code: string, message: string, status: number): never => {
  throw new IdentityAuthCompletionAbort({ flow, result: { verified: false, error: { code, message, status } } });
};
export const guardAuthStep = async <T>(flow: IdentityAuthCompletionFlowV1, stage: 'credential' | 'challenge' | 'invitation' | 'ticket' | 'proof' | 'session' | 'social', operation: () => Promise<T>): Promise<T> => {
  try { return await operation(); } catch (error) {
    const frozen = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    const code = error instanceof IdentityCustodyErrorV1 ? error.code
      : frozen === 'proof_verification_failed' || frozen === 'invitation_invalid' ? frozen : null;
    if (!code) throw error;
    if (flow === 'registration' || flow === 'authentication') {
      if (stage === 'credential' && code === 'webauthn_credential_conflict') refuseWebAuthn(flow, 'duplicate_credential', 'Credential is already registered.', 409);
      if (flow === 'authentication' && stage === 'credential' && code === 'proof_verification_failed') refuseWebAuthn(flow, 'credential_not_found', 'Credential was not found.', 401);
      if (['webauthn_credential_stale', 'webauthn_counter_rejected'].includes(code)) refuseWebAuthn(flow, 'authentication_verification_failed', 'Authentication verification failed.', 401);
      if (stage === 'challenge' && ['proof_state_conflict', 'proof_verification_failed'].includes(code)) refuseWebAuthn(flow, 'invalid_or_expired_challenge', flow === 'registration' ? 'Registration challenge is invalid or expired.' : 'Authentication challenge is invalid or expired.', 400);
      if (stage === 'challenge' && code === 'proof_binding_mismatch') refuseWebAuthn(flow, 'challenge_user_mismatch', 'Authentication challenge does not belong to this user.', 400);
      if (['invitation', 'ticket'].includes(stage) && ['proof_binding_mismatch', 'proof_state_conflict', 'proof_verification_failed', 'invitation_invalid'].includes(code)) refuseWebAuthn(flow, 'registration_verification_failed', 'Registration verification failed.', 400);
    }
    if ((flow === 'magic_link' || flow === 'email_code') && ['proof_binding_mismatch', 'proof_state_conflict', 'proof_verification_failed'].includes(code)) {
      const magic = flow === 'magic_link';
      throw new IdentityAuthCompletionAbort({ flow, result: { valid: false, error: { code: magic ? 'invalid_or_expired_magic_link' : 'invalid_or_expired_code',
        message: magic ? 'Magic link is invalid or expired.' : 'Verification code is invalid or expired.', status: 400 } } });
    }
    if (['session_validate', 'session_refresh'].includes(flow) && ['login_binding_mismatch', 'login_refresh_conflict'].includes(code)) return finishAuthCompletion(flow, null as T);
    if (flow === 'social_unlink' && code === 'proof_state_conflict') return finishAuthCompletion(flow, false as T);
    throw error;
  }
};
