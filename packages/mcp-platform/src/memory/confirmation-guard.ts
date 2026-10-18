import { isValidCursor, isValidDigest, isValidInstant, isValidOpaqueRef } from './contracts.js';
import { closed, validDelegation } from './context-validation.js';
import type { ExpectedConfirmationContinuationBindingV1, MemoryConfirmationContinuationV1 } from './frozen-confirmation.js';

const REF_KEYS = ['elicitation_ref', 'connector_instance_ref', 'tenant_id', 'initiating_principal_namespace',
  'initiating_principal_id', 'agent_id', 'mcp_client_id', 'logical_session_ref', 'transport_attachment_ref',
  'store_id', 'scope_ref', 'target_ref', 'reservation_ref'] as const;
const IDENTITY_KEYS = ['capability', 'provider_id', 'provider_contract_version', 'connector_id', 'active_generation', 'operation_digest'] as const;
const ASSURANCE_KEYS = ['enrolled_oidc_domain', 'issuer', 'approving_subject_sub', 'approving_human_principal_id',
  'enrollment_receipt_digest', 'step_up_2fa_receipt_digest', 'assurance_policy_version', 'authenticated',
  'enrolled_2fa', 'step_up_assurance_verified', 'hardware_key_required', 'identity_source', 'delegation'];
const CURRENT_VERDICTS = ['caller_currently_authorized', 'target_currently_authorized', 'approver_currently_enrolled_2fa',
  'approver_not_revoked', 'approver_current_assurance_verified', 'host_deployment_qualified'] as const;

/** A06 effect guard. Current authorization and assurance are independent literal-true decisions. */
export function checkFrozenConfirmation(c: MemoryConfirmationContinuationV1, e: ExpectedConfirmationContinuationBindingV1): string[] {
  if (!e || CURRENT_VERDICTS.some(k => e[k] !== true)) return ['confirmation: current authority and assurance must each be literal true'];
  if (!['uncommitted', 'committed'].includes(e.reservation_state)) return ['confirmation: durable outcome unresolved'];
  if (!closed(c, [...REF_KEYS, ...IDENTITY_KEYS, 'continuation_ref', 'mode', 'approved', 'issued_at', 'expires_at', 'assurance', 'reattachment_proof'])) return ['confirmation: closed continuation required'];
  if (c.mode !== 'confirm' || c.approved !== true || !isValidOpaqueRef(c.continuation_ref)) return ['confirmation: affirmative confirm continuation required'];
  const failures: string[] = [];
  for (const k of REF_KEYS) {
    if (!isValidOpaqueRef(c[k]) || !isValidOpaqueRef(e[k]) ||
        (k !== 'transport_attachment_ref' && c[k] !== e[k])) failures.push(`confirmation.${k}: binding mismatch`);
  }
  for (const k of IDENTITY_KEYS) if (c[k] !== e[k]) failures.push(`confirmation.${k}: binding mismatch`);
  if (!['engram_memory_withdraw', 'engram_memory_forget'].includes(c.capability) || c.provider_id !== 'sentropic.engram.memory' ||
      c.provider_contract_version !== '1.0.0' || c.connector_id !== 'engram-memory' ||
      !isValidCursor(c.active_generation) || !isValidDigest(c.operation_digest)) failures.push('confirmation: invalid identity');
  const a = c.assurance;
  if (!closed(a, ASSURANCE_KEYS)) return [...failures, 'confirmation: closed assurance required'];
  if (a.enrolled_oidc_domain !== 'sent-tech.ca' || a.identity_source !== 'enrolled_oidc_2fa' ||
      a.hardware_key_required !== false || a.authenticated !== true || a.enrolled_2fa !== true ||
      a.step_up_assurance_verified !== true) failures.push('confirmation: enrolled OIDC/2FA assurance required');
  for (const k of ['issuer', 'approving_subject_sub', 'approving_human_principal_id', 'assurance_policy_version'] as const) {
    if (!isValidOpaqueRef(a[k])) failures.push(`confirmation.assurance.${k}: invalid`);
  }
  if (!isValidDigest(a.enrollment_receipt_digest) || !isValidDigest(a.step_up_2fa_receipt_digest)) failures.push('confirmation: assurance receipts required');
  if (!isValidOpaqueRef(e.expected_issuer) || a.issuer !== e.expected_issuer ||
      !isValidOpaqueRef(e.approving_subject_sub) || a.approving_subject_sub !== e.approving_subject_sub ||
      !isValidOpaqueRef(e.approving_human_principal_id) || a.approving_human_principal_id !== e.approving_human_principal_id ||
      !Array.isArray(e.accepted_assurance_policy_versions) || !e.accepted_assurance_policy_versions.every(isValidOpaqueRef) ||
      !e.accepted_assurance_policy_versions.includes(a.assurance_policy_version)) failures.push('confirmation: current approving identity or policy mismatch');
  if (a.delegation !== undefined) {
    if (!validDelegation(a.delegation, e.now) || a.delegation.delegator_principal_id !== e.initiating_principal_id ||
        a.delegation.delegate_principal_id !== a.approving_human_principal_id) failures.push('confirmation: invalid delegation');
  } else if (a.approving_human_principal_id !== e.initiating_principal_id) failures.push('confirmation: delegation required');
  if (c.reattachment_proof !== undefined || c.transport_attachment_ref !== e.transport_attachment_ref) {
    const p = c.reattachment_proof;
    if (!closed(p, ['previous_attachment_ref', 'current_attachment_ref', 'reattachment_receipt_digest', 'verified', 'admitted_generation']) ||
        Reflect.ownKeys(p).length !== 5 || p.verified !== true || p.previous_attachment_ref !== c.transport_attachment_ref ||
        p.current_attachment_ref !== e.transport_attachment_ref || p.admitted_generation !== e.active_generation ||
        !isValidDigest(p.reattachment_receipt_digest)) failures.push('confirmation: authenticated reattachment required');
  }
  if (![c.issued_at, c.expires_at, e.now, e.execution_deadline_at].every(isValidInstant)) return [...failures, 'confirmation: canonical instants required'];
  const issued = Date.parse(c.issued_at), expires = Date.parse(c.expires_at), now = Date.parse(e.now), end = Date.parse(e.execution_deadline_at);
  if (expires <= issued || expires - issued > 300000 || now < issued) failures.push('confirmation.ttl: invalid ordered interval');
  if (e.reservation_state !== 'committed') {
    if (now >= expires) failures.push('confirmation.expiry: expired');
    if (end < now || end - now > 30000 || end > expires) failures.push('confirmation.execution: invalid execution deadline');
  }
  return failures;
}
