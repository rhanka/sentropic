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
  if (!isNonEmptyString(tenant)) {
    throw new MemoryTrustedContextError('authorized tenant missing');
  }
  const workspace = (ctx as { workspaceRef?: unknown }).workspaceRef;
  if (workspace !== undefined && workspace === tenant) {
    throw new MemoryTrustedContextError('workspace must not substitute for tenant');
  }
  return ctx;
}

/**
 * Project a verified host context plus the validated domain purpose onto the
 * closed memory projection. The context MUST already satisfy
 * `requireTrustedInvocationContext`; the purpose MUST be the validated
 * `purpose_ref` domain argument. Value-by-value copy: nothing is invented,
 * defaulted or reinterpreted beyond the documented host-derivation rules.
 */
export function projectMemoryContext(
  ctx: StpConnectorContext,
  purposeRef: string,
): MemoryContextProjectionV1 {
  const verified = requireTrustedInvocationContext(ctx);
  if (!isValidOpaqueRef(purposeRef)) {
    throw new MemoryTrustedContextError('purpose reference invalid');
  }
  const principal = verified.principal;
  const claims =
    principal.claims !== undefined && principal.claims !== null && typeof principal.claims === 'object'
      ? (principal.claims as Record<string, unknown>)
      : {};
  const claimedAgent = claims['agent_ref'];
  const agentRef =
    isValidOpaqueRef(claimedAgent) && typeof claimedAgent === 'string'
      ? claimedAgent
      : principal.sub;
  const session = verified.session as { mcpSessionId?: unknown } | undefined;
  const sessionId =
    session !== undefined && session !== null && typeof session === 'object'
      ? session.mcpSessionId
      : undefined;
  if (!isNonEmptyString(sessionId)) {
    throw new MemoryTrustedContextError('logical session missing');
  }
  if (!isNonEmptyString(verified.connectorInstanceId)) {
    throw new MemoryTrustedContextError('connector instance missing');
  }
  return {
    principalNamespace: 'sentropic.principal',
    principalId: principal.sub,
    tenantId: verified.tenantRef,
    storeRef: verified.connectorInstanceId,
    scopeRef: verified.tenantRef,
    purposeRef,
    agentRef,
    connectorInstanceRef: verified.connectorInstanceId,
    policyEpoch: principal.authTime as string,
    attachmentGeneration: verified.requestId,
    auditRef: verified.auditId,
    idempotencyKey: verified.correlationId,
    elicitationRef: null,
  };
}

/** Validate the frozen projection's binding and trusted receipt carriers. */
export function validateMemoryProjection(projection: MemoryContextProjectionV1): string[] {
  return projection?.trusted_context && projection?.verified_claims && projection?.routing_provenance &&
    projection?.session_attachment && projection?.envelope_bindings ? [] : ['projection: incomplete A03 projection'];
}
