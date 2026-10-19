export function confirmationInput(): any {
  const assurance = {
    enrolled_oidc_domain: 'sent-tech.ca', issuer: 'https://sent-tech.ca', approving_subject_sub: 'sub-1',
    approving_human_principal_id: 'user-1', enrollment_receipt_digest: `sha256:${'a'.repeat(64)}`,
    step_up_2fa_receipt_digest: `sha256:${'b'.repeat(64)}`, assurance_policy_version: 'assurance/v1',
    authenticated: true, enrolled_2fa: true, step_up_assurance_verified: true,
    hardware_key_required: false, identity_source: 'enrolled_oidc_2fa',
  };
  const binding = {
    elicitation_ref: 'elicit-1', capability: 'engram_memory_withdraw', provider_id: 'sentropic.engram.memory',
    provider_contract_version: '1.0.0', connector_id: 'engram-memory', connector_instance_ref: 'ci-1',
    tenant_id: 'tenant-1', initiating_principal_namespace: 'ns-1', initiating_principal_id: 'user-1',
    agent_id: 'agent-1', mcp_client_id: 'client-1', logical_session_ref: 'session-1',
    transport_attachment_ref: 'attachment-1', active_generation: '1', store_id: 'store-1', scope_ref: 'scope-1',
    target_ref: 'candidate-1', reservation_ref: 'reservation-1', operation_digest: `sha256:${'c'.repeat(64)}`,
  };
  return {
    continuation: { ...binding, continuation_ref: 'continuation-1', mode: 'confirm', approved: true,
      issued_at: '2026-10-18T00:00:00.000Z', expires_at: '2026-10-18T00:05:00.000Z', assurance },
    expected: { ...binding, now: '2026-10-18T00:00:20.000Z', execution_deadline_at: '2026-10-18T00:00:50.000Z',
      caller_currently_authorized: true, target_currently_authorized: true,
      approving_human_principal_id: 'user-1', approving_subject_sub: 'sub-1',
      approver_currently_enrolled_2fa: true, approver_not_revoked: true, approver_current_assurance_verified: true,
      expected_issuer: assurance.issuer, accepted_assurance_policy_versions: ['assurance/v1'],
      host_deployment_qualified: true, reservation_state: 'uncommitted' },
  };
}
