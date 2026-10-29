import type { StpConnectorContext, ChannelBindingKindV1 } from '@sentropic/mcp-platform/memory';
import { D, NOW, DEADLINE } from './mcp-dependencies.js';

export function mcpContext(tenant: string, scopeRef: string, storeId: string,
  args: { idempotency_key?: string } = {}, channel: ChannelBindingKindV1 = 'in_process_verified'): StpConnectorContext {
  return {
    requestId: 'request-memory', correlationId: 'correlation-memory', auditId: 'audit-memory',
    principal: { sub: 'user-memory', claims: { sub: 'user-memory', tid: tenant }, scopes: ['mcp:discover', 'mcp:tools:invoke'], tenantRef: tenant, authTime: NOW },
    surface: 'backend', mcpClient: { clientId: 'client-memory', client: 'codex' },
    workspaceRef: 'workspace-memory', session: { mcpSessionId: 'session-memory' }, tenantRef: tenant,
    connectorInstanceId: 'connector-memory', consentRefs: [], grantRefs: [],
    memory: { expectedActiveGeneration: '1', expectedPolicyEpoch: '1', now: NOW, binding: {
      issuer: 'issuer-memory', sub: 'user-memory', tid: tenant, claims: ['sub', 'tid'], claims_provenance_receipt: D,
      principal_namespace: 'namespace-memory', principal_id: 'user-memory', tenant_id: tenant,
      tenant_membership_receipt: D, tenant_resolution_source: 'authoritative_membership',
      workspace_id: 'workspace-memory', agent_id: 'agent-memory', mcp_client_id: 'client-memory',
      logical_session_ref: 'session-memory', transport_attachment_ref: 'attachment-memory', connection_proof_digest: D,
      publisher_id: 'sentropic.engram.memory', provider_id: 'sentropic.engram.memory', connector_id: 'engram-memory',
      connector_instance_ref: 'connector-memory', selected_source_id: 'mcp:engram-memory', store_id: storeId,
      scope_ref: scopeRef, purpose_ref: 'purpose-memory', active_generation: '1', policy_epoch: '1',
      audit_id: 'audit-memory', correlation_ref: 'correlation-memory', deadline_at: DEADLINE,
      cancellation_ref: 'cancellation-memory', issued_at: NOW, channel_binding: channel,
      transport_scopes: ['mcp:discover', 'mcp:tools:invoke'], elicitation_ref: 'elicitation-memory',
      ...(args.idempotency_key ? { idempotency_key: args.idempotency_key } : {}), neutral_credential: `credential-${tenant}`,
    } },
  } as StpConnectorContext;
}
