import type { MemoryMutationPreimageV1 } from '@sentropic/mcp-platform/memory';
import { computeMutationDigest } from '@sentropic/mcp-platform/memory';
import type { MemoryConfirmationContinuationV1, ExpectedConfirmationContinuationBindingV1 } from '@sentropic/mcp-platform/memory';
export function workflowInput(overrides: Partial<MemoryMutationPreimageV1> = {}) {
  const preimage: MemoryMutationPreimageV1 = {
    profile: 'sentropic.engram.memory-mutation/v1', reservation_ref: 'reservation-1',
    provider_id: 'sentropic.engram.memory', provider_contract_version: '1.0.0',
    principal_namespace: 'sentropic.principal', principal_id: 'human-1', tenant_id: 'tenant-1',
    store_id: 'canonical-pg', connector_id: 'engram-memory', connector_instance_ref: 'instance-1',
    scope_ref: 'workspace-distinct-from-tenant', tool_name: 'engram_memory_request_admission',
    idempotency_key: '0123456789abcdef', target: { kind: 'candidate', candidate_id: 'candidate-1' },
    effective_input: { tool_name: 'engram_memory_request_admission', candidate_id: 'candidate-1', admission_policy_version: 'v1' },
    ...overrides,
  };
  return { preimage, digest: computeMutationDigest(preimage),
    policyVersions: { tool_name: 'engram_memory_request_admission' as const, admission_policy_version: 'v1' },
    resolved: { retention: 'original', consent: 'consent-1', source: 'source-1', event: 'event-1', provenance: 'anchor-1' },
    audit: { auditId: 'audit-1', correlationId: 'correlation-1' } };
}
export function confirmationFixture(p: MemoryMutationPreimageV1, digest: string) {
  const continuation: MemoryConfirmationContinuationV1 = {
    continuation_ref: 'continuation-1', elicitation_ref: 'elicitation-1', mode: 'confirm', capability: 'engram_memory_withdraw',
    provider_id: p.provider_id, provider_contract_version: '1.0.0', connector_id: p.connector_id,
    connector_instance_ref: p.connector_instance_ref, tenant_id: p.tenant_id, initiating_principal_namespace: p.principal_namespace,
    initiating_principal_id: p.principal_id, agent_id: 'agent-1', mcp_client_id: 'client-1', logical_session_ref: 'logical-1',
    transport_attachment_ref: 'attachment-1', active_generation: '1', store_id: p.store_id, scope_ref: p.scope_ref,
    target_ref: 'candidate-1', reservation_ref: p.reservation_ref, operation_digest: digest as `sha256:${string}`,
    approved: true, issued_at: '2026-10-26T00:00:00.000Z', expires_at: '2026-10-26T00:05:00.000Z',
    assurance: { enrolled_oidc_domain: 'sent-tech.ca', issuer: 'https://qualification.memory.test',
      approving_subject_sub: 'subject-1', approving_human_principal_id: p.principal_id,
      enrollment_receipt_digest: 'sha256:' + 'a'.repeat(64) as `sha256:${string}`,
      step_up_2fa_receipt_digest: 'sha256:' + 'b'.repeat(64) as `sha256:${string}`,
      assurance_policy_version: 'qualification/v1', authenticated: true, enrolled_2fa: true,
      step_up_assurance_verified: true, hardware_key_required: false, identity_source: 'enrolled_oidc_2fa' },
  };
  const expected: ExpectedConfirmationContinuationBindingV1 = { ...continuation,
    now: '2026-10-26T00:00:01.000Z', execution_deadline_at: '2026-10-26T00:00:31.000Z',
    caller_currently_authorized: true, target_currently_authorized: true, approving_human_principal_id: p.principal_id,
    approving_subject_sub: 'subject-1', approver_currently_enrolled_2fa: true, approver_not_revoked: true,
    approver_current_assurance_verified: true, expected_issuer: continuation.assurance.issuer,
    accepted_assurance_policy_versions: ['qualification/v1'], host_deployment_qualified: true, reservation_state: 'uncommitted' };
  return { continuation, expected };
}
