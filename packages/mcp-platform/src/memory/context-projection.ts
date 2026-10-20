import type { StpConnectorContext } from '../runtime.js';
import type { MemoryContextProjectionV1 } from './frozen-context.js';
import { validateBinding } from './context-validation.js';

/** Copies A03 values without substituting request, tenant or connector selectors. */
export function projectVerifiedMemoryContext(ctx: StpConnectorContext, purposeRef: string): MemoryContextProjectionV1 {
  const host = ctx.memory;
  if (!host) throw new Error('memory host binding absent');
  const failures = validateBinding(host.binding, host.expectedActiveGeneration, host.expectedPolicyEpoch, host.now);
  const b = host.binding;
  if (b.sub !== ctx.principal.sub || b.sub !== ctx.principal.claims.sub || b.tid !== ctx.principal.claims.tid ||
      b.tenant_id !== ctx.tenantRef || b.tenant_id !== ctx.principal.tenantRef ||
      b.connector_instance_ref !== ctx.connectorInstanceId || b.logical_session_ref !== ctx.session?.mcpSessionId ||
      b.mcp_client_id !== ctx.mcpClient?.clientId || b.audit_id !== ctx.auditId || b.correlation_ref !== ctx.correlationId ||
      b.purpose_ref !== purposeRef || b.workspace_id !== ctx.workspaceRef ||
      b.claims.some(c => !Object.prototype.hasOwnProperty.call(ctx.principal.claims, c))) failures.push('host binding mismatch');
  if (failures.length) throw new Error(failures.join('; '));
  const auth = { credential: b.neutral_credential, ...(b.neutral_context_ref !== undefined ? { context_ref: b.neutral_context_ref } : {}) };
  return {
    agent_id: b.agent_id, purpose_ref: b.purpose_ref, ...(b.delegation ? { delegation: { ...b.delegation } } : {}),
    trusted_context: {
      principal_namespace: b.principal_namespace, principal_id: b.principal_id, tenant_id: b.tenant_id,
      store_id: b.store_id, connector_id: b.connector_id, scope_ref: b.scope_ref, mcp_client_id: b.mcp_client_id,
      session_id: b.logical_session_ref, correlation_id: b.correlation_ref, now_utc: host.now,
      deadline_ms: Date.parse(b.deadline_at) - Date.parse(host.now), authorization_context: auth, policy_epoch: b.policy_epoch,
    },
    neutral_authorization: auth, neutral_scope_ref: b.scope_ref,
    neutral_principal: { principal_namespace: b.principal_namespace, principal_id: b.principal_id, tenant_id: b.tenant_id },
    verified_claims: { issuer: b.issuer, sub: b.sub, tid: b.tid, claims_provenance_receipt: b.claims_provenance_receipt, tenant_membership_receipt: b.tenant_membership_receipt },
    lifecycle_binding: { deadline_at: b.deadline_at, cancellation_ref: b.cancellation_ref },
    channel_binding: b.channel_binding, transport_scopes: [...b.transport_scopes],
    session_attachment: { mcp_client_id: b.mcp_client_id, logical_session_ref: b.logical_session_ref, transport_attachment_ref: b.transport_attachment_ref, connection_proof_digest: b.connection_proof_digest },
    routing_provenance: { publisher_id: b.publisher_id, provider_id: b.provider_id, connector_id: b.connector_id, connector_instance_ref: b.connector_instance_ref, selected_source_id: b.selected_source_id, active_generation: b.active_generation, policy_epoch: b.policy_epoch },
    envelope_bindings: { ...(b.idempotency_key !== undefined ? { idempotency_key: b.idempotency_key } : {}), ...(b.elicitation_ref !== undefined ? { elicitation_ref: b.elicitation_ref } : {}), audit_id: b.audit_id, correlation_ref: b.correlation_ref },
  };
}
