import { projectVerifiedMemoryContext } from './context-projection.js';
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
  if (!isNonEmptyString(tenant) || tenant !== tenantRef || tenant !== ctx.principal.claims?.tid || sub !== ctx.principal.claims?.sub) {
    throw new MemoryTrustedContextError('authorized tenant missing');
  }
  const workspace = (ctx as { workspaceRef?: unknown }).workspaceRef;
  if (workspace !== undefined && workspace === tenant) {
    throw new MemoryTrustedContextError('workspace must not substitute for tenant');
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
  return projection?.trusted_context && projection?.verified_claims && projection?.routing_provenance &&
    projection?.session_attachment && projection?.envelope_bindings ? [] : ['projection: incomplete A03 projection'];
}
