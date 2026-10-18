/**
 * MCP-L5 Lot 1 — verified memory context projection (broker seam).
 *
 * Builds the closed `MemoryContextProjectionV1` from a trusted host
 * `StpConnectorContext` plus the validated domain purpose and envelope
 * references. Refuses before any provider contact when the context, audit,
 * purpose, idempotency key or elicitation binding is missing or untrusted.
 */

import type { StpConnectorContext } from '@sentropic/mcp-platform';
import {
  isValidIdempotencyKey,
  isValidOpaqueRef,
  projectMemoryContext,
  requireTrustedInvocationContext,
  type MemoryContextProjectionV1,
} from '@sentropic/mcp-platform/memory';

export type BindMemoryInvocationInput = {
  ctx: StpConnectorContext;
  purposeRef: string;
  idempotencyKey: string;
  elicitationRef?: string;
};

export type BoundMemoryInvocationV1 = {
  projection: MemoryContextProjectionV1;
  auditRef: string;
};

/**
 * Bind one memory invocation: verify the host context, project the neutral
 * context, and attach the envelope idempotency key and optional elicitation
 * reference. Throws `MemoryTrustedContextError` (protocol -32603) on any
 * missing or untrusted binding. No provider is contacted here.
 */
export function bindMemoryInvocation(input: BindMemoryInvocationInput): BoundMemoryInvocationV1 {
  const verified = requireTrustedInvocationContext(input.ctx);
  if (!isValidIdempotencyKey(input.idempotencyKey)) {
    throw new Error('bindMemoryInvocation: idempotencyKey must be a valid IdempotencyKey');
  }
  if (input.elicitationRef !== undefined && !isValidOpaqueRef(input.elicitationRef)) {
    throw new Error('bindMemoryInvocation: elicitationRef must be a valid OpaqueRef');
  }
  const projection = projectMemoryContext(verified, input.purposeRef);
  projection.idempotencyKey = input.idempotencyKey;
  projection.elicitationRef = input.elicitationRef ?? null;
  return { projection, auditRef: verified.auditId };
}

export { projectMemoryContext, requireTrustedInvocationContext };
