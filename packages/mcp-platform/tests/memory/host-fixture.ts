import type { StpConnectorContext } from '../../src/runtime.js';

/** Explicit host bindings; no field is inferred from a selector or request ID. */
export function hostContext(): StpConnectorContext {
  const digest = `sha256:${'a'.repeat(64)}`;
  return {
    requestId: 'req-1', correlationId: 'corr-1', auditId: 'audit-host-1',
    principal: {
      sub: 'user-1', tenantRef: 'tenant-1', authTime: '2026-10-18T00:00:00.000Z',
      claims: { sub: 'user-1', tid: 'tenant-1' }, scopes: ['mcp:tools:invoke'],
    },
    surface: 'backend', mcpClient: { clientId: 'client-1', client: 'codex' },
    session: { mcpSessionId: 'session-1' }, tenantRef: 'tenant-1', connectorInstanceId: 'ci-1',
    consentRefs: [], grantRefs: [], connectorConfig: {}, logger: undefined,
    getSecret: async () => '', audit: { emit: async () => undefined },
    memory: {
      binding: {
        issuer: 'https://sent-tech.ca', sub: 'user-1', tid: 'tenant-1', claims: ['sub', 'tid'],
        claims_provenance_receipt: digest, principal_namespace: 'sentropic.principal', principal_id: 'user-1',
        tenant_id: 'tenant-1', tenant_membership_receipt: digest, tenant_resolution_source: 'authoritative_membership',
        agent_id: 'agent-1', mcp_client_id: 'client-1', logical_session_ref: 'session-1',
        transport_attachment_ref: 'attachment-1', connection_proof_digest: digest,
        publisher_id: 'sentropic.engram.memory', provider_id: 'sentropic.engram.memory', connector_id: 'engram-memory',
        connector_instance_ref: 'ci-1', selected_source_id: 'mcp:engram-memory', store_id: 'store-1',
        scope_ref: 'scope-1', purpose_ref: 'purpose-1', active_generation: '1', policy_epoch: '2',
        audit_id: 'audit-host-1', correlation_ref: 'corr-1', deadline_at: '2026-10-18T00:00:30.000Z',
        cancellation_ref: 'cancel-1', issued_at: '2026-10-18T00:00:00.000Z',
        channel_binding: 'in_process_verified', transport_scopes: ['mcp:tools:invoke'],
        neutral_credential: 'credential-1',
      },
      expectedActiveGeneration: '1', expectedPolicyEpoch: '2', now: '2026-10-18T00:00:00.000Z',
    },
  } as StpConnectorContext;
}
