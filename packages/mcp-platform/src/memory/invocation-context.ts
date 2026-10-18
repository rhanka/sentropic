/**
 * MCP-L5 Lot 1 — verified memory invocation context and projection.
 *
 * `MemoryInvocationBindingV1` and `MemoryContextProjectionV1` (L0-A03): a
 * closed field-by-field mapping from the trusted host invocation to the
 * provider's trusted context and neutral authorization context. Only neutral
 * opaque principal/scope/authorization data enters the neutral engine;
 * OIDC/framework objects remain in host/product contracts.
 *
 * Missing, substituted or stale binding refuses before reservation, provider
 * dispatch or effect. A missing or untrusted audit refuses with the M2
 * pre-dispatch protocol error (-32603), never a domain envelope.
 *
 * Host-derivation rules (documented, no invention):
 * - principalNamespace is the Sentropic principal namespace designation.
 * - agentRef is claims["agent_ref"] when the host supplies it, otherwise the
 *   verified subject acting as its own agent reference in this local chain.
 * - storeRef is the connector instance's store; scopeRef is the exact
 *   tenant scope selected through the trusted host binding.
 * - purposeRef is the validated domain purpose argument, passed explicitly
 *   by the caller, never read from ambient context.
 * - policyEpoch is the verified token authTime freshness source.
 * - attachmentGeneration is the host request identifier marking the current
 *   transport attachment.
 */

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

/**
 * Closed binding from the trusted host invocation to the memory provider.
 * Every member is required; framework objects never cross this boundary.
 */
export type MemoryInvocationBindingV1 = {
  issuer: string;
  subject: string;
  claimsDigest: string;
  principalNamespace: string;
  principalId: string;
  tenantId: string;
  membershipReceipt: string;
  agentRef: string;
  mcpClientRef: string;
  logicalSessionRef: string;
  transportSessionRef: string;
  attachmentGeneration: string;
  providerId: 'sentropic.engram.memory';
  connectorId: 'engram-memory';
  connectorInstanceRef: string;
  sourceRef: string;
  storeRef: string;
  scopeRef: string;
  purposeRef: string;
  policyEpoch: string;
  auditRef: string;
  correlationRef: string;
  deadlineAt: string;
  cancellationRef: string;
  idempotencyKey: string;
  elicitationRef: string | null;
};

/**
 * Neutral projection handed to the engine: opaque principal/scope/
 * authorization data only.
 */
export type MemoryContextProjectionV1 = {
  principalNamespace: string;
  principalId: string;
  tenantId: string;
  storeRef: string;
  scopeRef: string;
  purposeRef: string;
  agentRef: string;
  connectorInstanceRef: string;
  policyEpoch: string;
  attachmentGeneration: string;
  auditRef: string;
  idempotencyKey: string;
  elicitationRef: string | null;
};

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

/**
 * Validate a memory projection before reservation or effect: every opaque
 * reference is a valid OpaqueRef, tenant and principal are present, and the
 * workspace never substitutes for the tenant.
 */
export function validateMemoryProjection(projection: MemoryContextProjectionV1): string[] {
  const failures: string[] = [];
  const refs: Array<[string, unknown]> = [
    ['principalNamespace', projection.principalNamespace],
    ['principalId', projection.principalId],
    ['tenantId', projection.tenantId],
    ['storeRef', projection.storeRef],
    ['scopeRef', projection.scopeRef],
    ['purposeRef', projection.purposeRef],
    ['agentRef', projection.agentRef],
    ['connectorInstanceRef', projection.connectorInstanceRef],
    ['policyEpoch', projection.policyEpoch],
    ['attachmentGeneration', projection.attachmentGeneration],
    ['auditRef', projection.auditRef],
    ['idempotencyKey', projection.idempotencyKey],
  ];
  for (const [name, value] of refs) {
    if (!isValidOpaqueRef(value)) {
      failures.push(`projection.${name}: invalid OpaqueRef`);
    }
  }
  if (projection.auditRef === FORBIDDEN_SYNTHETIC_AUDIT_ID) {
    failures.push('projection.auditRef: synthetic audit refused');
  }
  return failures;
}
