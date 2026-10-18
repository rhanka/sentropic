import { projectVerifiedMemoryContext } from './context-projection.js';
import { closed, validateBinding } from './context-validation.js';
import type { StpConnectorContext } from '../runtime.js';
import {
  TRUSTED_CONTEXT_PROTOCOL_ERROR_CODE,
  TRUSTED_CONTEXT_UNAVAILABLE_MESSAGE,
  FORBIDDEN_SYNTHETIC_AUDIT_ID,
  isValidOpaqueRef,
} from './contracts.js';

/** Protocol refusal for a missing or untrusted invocation context (M2). */
export class MemoryTrustedContextError extends Error {
  readonly protocolCode = TRUSTED_CONTEXT_PROTOCOL_ERROR_CODE;

  constructor(detail?: string) {
    super(
      detail !== undefined
        ? `${TRUSTED_CONTEXT_UNAVAILABLE_MESSAGE}: ${detail}`
        : TRUSTED_CONTEXT_UNAVAILABLE_MESSAGE,
    );
    this.name = 'MemoryTrustedContextError';
  }
}

export type { MemoryInvocationBindingV1, MemoryContextProjectionV1 } from './frozen-context.js';
import type { MemoryContextProjectionV1 } from './frozen-context.js';
/** Literal-true verdict rule (M4): only the Boolean literal true authorizes. */
export function isLiteralTrueVerdict(value: unknown): value is true {
  return value === true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Require a trusted host invocation context. Refuses with the M2 protocol
 * error when the context or its audit reference is absent, malformed,
 * synthetic or unauthenticated. Never fabricates an audit reference.
 */
export function requireTrustedInvocationContext(
  ctx: StpConnectorContext | undefined | null,
): StpConnectorContext {
  if (ctx === undefined || ctx === null || typeof ctx !== 'object') {
    throw new MemoryTrustedContextError('no invocation context supplied');
  }
  const auditId = (ctx as { auditId?: unknown }).auditId;
  if (!isNonEmptyString(auditId)) {
    throw new MemoryTrustedContextError('audit reference absent or malformed');
  }
  if (auditId === FORBIDDEN_SYNTHETIC_AUDIT_ID) {
    throw new MemoryTrustedContextError('synthetic audit reference refused');
  }
  const principal = (ctx as { principal?: unknown }).principal;
  if (principal === undefined || principal === null || typeof principal !== 'object') {
    throw new MemoryTrustedContextError('principal missing');
  }
  const { sub, tenantRef, authTime } = principal as {
    sub?: unknown;
    tenantRef?: unknown;
    authTime?: unknown;
  };
  if (!isNonEmptyString(sub) || !isNonEmptyString(tenantRef)) {
    throw new MemoryTrustedContextError('subject or tenant missing');
  }
  if (!isNonEmptyString(authTime)) {
    throw new MemoryTrustedContextError('authentication freshness source missing');
  }
  const tenant = (ctx as { tenantRef?: unknown }).tenantRef;
  if (!isNonEmptyString(tenant) || tenant !== tenantRef ||
      (ctx.principal.claims?.tid !== undefined && tenant !== ctx.principal.claims.tid) ||
      (ctx.principal.claims?.sub !== undefined && sub !== ctx.principal.claims.sub)) {
    throw new MemoryTrustedContextError('authorized tenant missing');
  }
  return ctx;
}

/** Preserve the accepted A03 projection from explicit verified host bindings. */
export function projectMemoryContext(ctx: StpConnectorContext, purposeRef: string): MemoryContextProjectionV1 {
  requireTrustedInvocationContext(ctx);
  try { return projectVerifiedMemoryContext(ctx, purposeRef); }
  catch (error) { throw new MemoryTrustedContextError(error instanceof Error ? error.message : 'invalid binding'); }
}

/** Validate the frozen projection's binding and trusted receipt carriers. */
export function validateMemoryProjection(projection: MemoryContextProjectionV1): string[] {
  const p = projection;
  if (!closed(p, ['agent_id', 'purpose_ref', 'delegation', 'trusted_context', 'neutral_authorization', 'neutral_scope_ref',
    'neutral_principal', 'verified_claims', 'lifecycle_binding', 'channel_binding', 'transport_scopes', 'session_attachment', 'routing_provenance', 'envelope_bindings'])) return ['projection: closed A03 record required'];
  const t = p.trusted_context, a = p.neutral_authorization, n = p.neutral_principal, v = p.verified_claims;
  const r = p.routing_provenance, s = p.session_attachment, e = p.envelope_bindings, l = p.lifecycle_binding;
  if (!closed(t, ['principal_id', 'principal_namespace', 'tenant_id', 'store_id', 'connector_id', 'scope_ref', 'mcp_client_id', 'session_id', 'correlation_id',
    'now_utc', 'deadline_ms', 'authorization_context', 'policy_epoch', 'trust_epoch', 'authorization_receipt_digest', 'authorization_issued_at', 'authorization_expires_at']) ||
    !closed(a, ['credential', 'context_ref']) || !closed(t.authorization_context, ['credential', 'context_ref']) ||
    !closed(n, ['principal_namespace', 'principal_id', 'tenant_id']) || !closed(v, ['issuer', 'sub', 'tid', 'claims_provenance_receipt', 'tenant_membership_receipt']) ||
    !closed(r, ['publisher_id', 'provider_id', 'connector_id', 'connector_instance_ref', 'selected_source_id', 'active_generation', 'policy_epoch']) ||
    !closed(s, ['mcp_client_id', 'logical_session_ref', 'transport_attachment_ref', 'connection_proof_digest']) ||
    !closed(e, ['idempotency_key', 'elicitation_ref', 'audit_id', 'correlation_ref']) || !closed(l, ['deadline_at', 'cancellation_ref'])) return ['projection: incomplete or open nested A03 record'];
  const failures = validateBinding({ ...v, ...r, ...e, ...l, ...s,
    principal_namespace: n.principal_namespace, principal_id: n.principal_id, tenant_id: n.tenant_id,
    store_id: t.store_id, scope_ref: p.neutral_scope_ref, purpose_ref: p.purpose_ref, agent_id: p.agent_id,
    claims: ['sub', 'tid'], tenant_resolution_source: 'authoritative_membership', issued_at: t.now_utc,
    channel_binding: p.channel_binding, transport_scopes: p.transport_scopes, neutral_credential: a.credential,
    ...(a.context_ref !== undefined ? { neutral_context_ref: a.context_ref } : {}), ...(p.delegation ? { delegation: p.delegation } : {}),
  }, r.active_generation, r.policy_epoch, t.now_utc);
  if (t.principal_namespace !== n.principal_namespace || t.principal_id !== n.principal_id || t.tenant_id !== n.tenant_id ||
      t.scope_ref !== p.neutral_scope_ref || t.connector_id !== r.connector_id || t.mcp_client_id !== s.mcp_client_id ||
      t.session_id !== s.logical_session_ref || t.correlation_id !== e.correlation_ref || t.policy_epoch !== r.policy_epoch ||
      a.credential !== t.authorization_context.credential || a.context_ref !== t.authorization_context.context_ref ||
      t.deadline_ms !== Date.parse(l.deadline_at) - Date.parse(t.now_utc)) failures.push('projection: inconsistent A03 mapping');
  return failures;
}
