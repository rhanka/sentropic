/** Co-frozen A06 declarations from Engram 60a8bfa8 policy.ts. */
import type { DelegationBindingV1 } from './frozen-context.js';
type OpaqueRef = string;
type Digest = `sha256:${string}`;
type Instant = string;
type Cursor = string;
type DestructiveMemoryToolName = 'engram_memory_withdraw' | 'engram_memory_forget';
export interface MemoryConfirmationAssuranceV1 {
  readonly enrolled_oidc_domain: 'sent-tech.ca';
  readonly issuer: OpaqueRef;
  readonly approving_subject_sub: OpaqueRef;
  readonly approving_human_principal_id: OpaqueRef;
  readonly enrollment_receipt_digest: Digest;
  readonly step_up_2fa_receipt_digest: Digest;
  readonly assurance_policy_version: OpaqueRef;
  readonly authenticated: boolean;
  readonly enrolled_2fa: boolean;
  readonly step_up_assurance_verified: boolean;
  readonly hardware_key_required: false;
  readonly identity_source: 'enrolled_oidc_2fa';
  readonly delegation?: DelegationBindingV1;
}
export interface MemoryLogicalSessionReattachmentProofV1 {
  readonly previous_attachment_ref: OpaqueRef;
  readonly current_attachment_ref: OpaqueRef;
  readonly reattachment_receipt_digest: Digest;
  readonly verified: boolean;
  readonly admitted_generation: Cursor;
}
export interface MemoryConfirmationContinuationV1 {
  readonly continuation_ref: OpaqueRef;
  readonly elicitation_ref: OpaqueRef;
  readonly mode: 'confirm';
  readonly capability: DestructiveMemoryToolName;
  readonly provider_id: 'sentropic.engram.memory';
  readonly provider_contract_version: '1.0.0';
  readonly connector_id: 'engram-memory';
  readonly connector_instance_ref: OpaqueRef;
  readonly tenant_id: OpaqueRef;
  readonly initiating_principal_namespace: OpaqueRef;
  readonly initiating_principal_id: OpaqueRef;
  readonly agent_id: OpaqueRef;
  readonly mcp_client_id: OpaqueRef;
  readonly logical_session_ref: OpaqueRef;
  readonly transport_attachment_ref: OpaqueRef;
  readonly active_generation: Cursor;
  readonly store_id: OpaqueRef;
  readonly scope_ref: OpaqueRef;
  readonly target_ref: OpaqueRef;
  readonly reservation_ref: OpaqueRef;
  readonly operation_digest: Digest;
  readonly approved: boolean;
  readonly issued_at: Instant;
  readonly expires_at: Instant;
  readonly assurance: MemoryConfirmationAssuranceV1;
  readonly reattachment_proof?: MemoryLogicalSessionReattachmentProofV1;
}
export interface ExpectedConfirmationContinuationBindingV1 {
  readonly elicitation_ref: OpaqueRef;
  readonly capability: DestructiveMemoryToolName;
  readonly provider_id: 'sentropic.engram.memory';
  readonly provider_contract_version: '1.0.0';
  readonly connector_id: 'engram-memory';
  readonly connector_instance_ref: OpaqueRef;
  readonly tenant_id: OpaqueRef;
  readonly initiating_principal_namespace: OpaqueRef;
  readonly initiating_principal_id: OpaqueRef;
  readonly agent_id: OpaqueRef;
  readonly mcp_client_id: OpaqueRef;
  readonly logical_session_ref: OpaqueRef;
  readonly transport_attachment_ref: OpaqueRef;
  readonly active_generation: Cursor;
  readonly store_id: OpaqueRef;
  readonly scope_ref: OpaqueRef;
  readonly target_ref: OpaqueRef;
  readonly reservation_ref: OpaqueRef;
  readonly operation_digest: Digest;
  readonly now: Instant;
  readonly execution_deadline_at: Instant;
  readonly caller_currently_authorized?: unknown;
  readonly target_currently_authorized?: unknown;
  readonly approving_human_principal_id: OpaqueRef;
  readonly approving_subject_sub: OpaqueRef;
  readonly approver_currently_enrolled_2fa: unknown;
  readonly approver_not_revoked: unknown;
  readonly approver_current_assurance_verified: unknown;
  readonly expected_issuer: OpaqueRef;
  readonly accepted_assurance_policy_versions: readonly OpaqueRef[];
  readonly host_deployment_qualified: unknown;
  readonly reservation_state: 'uncommitted' | 'committed' | 'unknown';
}

export type ConfirmationContinuationDecisionV1 =
  | { readonly ok: true; readonly decision: 'execute_confirmed' | 'disclose_committed_without_repeat_effect';
      readonly continuation: MemoryConfirmationContinuationV1 }
  | { readonly ok: false; readonly error_code: 'gate_failed' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'MUTATION_OUTCOME_UNKNOWN';
      readonly reason: string };
