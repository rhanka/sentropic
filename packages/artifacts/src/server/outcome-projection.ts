/** HTTP and platform result projections share one classified outcome; neither inspects causes. */
import type { AppToolResult } from '@sentropic/mcp-platform';
import type { HttpResponse } from '../http.js';
import type { ArtifactFailure, ArtifactOutcome } from './failures.js';

export function projectArtifactHttpOutcome(outcome: ArtifactOutcome<HttpResponse>): HttpResponse {
  if (outcome.ok) return outcome.result;
  return { status: outcome.failure.httpStatus, body: { error: outcome.failure.publicCode } };
}

/** Feed this application result to mcp-platform's existing result codec. No second wire protocol. */
export function projectArtifactMcpOutcome(outcome: ArtifactOutcome<HttpResponse>, auditId: string): AppToolResult {
  if (outcome.ok) return { ok: true, output: outcome.result.body, auditId, redactionClass: 'low' };
  const { publicCode, retriable } = outcome.failure;
  return {
    ok: false, auditId, redactionClass: 'low',
    error: { code: publicCode, message: publicCode, retriable },
  };
}

export interface ArtifactWriteFailure {
  readonly invocationId: string;
  readonly operation: string;
  readonly reason: 'provider_unavailable' | 'provider_conflict' | 'unauthorized_at_commit' | 'provider_error';
  readonly status: number;
}

/**
 * Pure accounting descriptor. The host persists/deduplicates by invocation ID;
 * observing the same outcome in nested adapters never records another event here.
 */
export function projectArtifactWriteFailure(
  failure: ArtifactFailure,
  dispatch: { readonly dispatched: boolean; readonly write: boolean },
): ArtifactWriteFailure | undefined {
  if (failure.kind !== 'operational' || !dispatch.dispatched || !dispatch.write
    || failure.phase === 'selection' || failure.phase === 'admit'
    || failure.category === 'capability_unselected') return undefined;
  const reason = failure.category === 'conflict' ? 'provider_conflict'
    : failure.category === 'provider_unavailable' || failure.category === 'unauthorized_at_commit'
      ? failure.category : 'provider_error';
  return { invocationId: failure.invocationId, operation: failure.operation, reason, status: failure.httpStatus };
}
