/**
 * L0 frozen failure declaration (immo #861, ask 3 shape only).
 *
 * Stable internal outcome shape and category-to-public mapping table.
 * Driver detail stays in the private cause and never enters HTTP bodies,
 * MCP results or metadata. The classifier implementation lands in L2.
 */

import type { CommitState } from './commit-contract.js';

/** Internal failure categories, distinct from validation/not-found/gone outcomes. */
export const FAILURE_CATEGORIES = [
  'provider_unavailable', 'conflict', 'unauthorized_at_commit', 'provider_error',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** Frozen category-to-public projection (ask 3, table E2). */
export interface FailureProjection {
  readonly category: FailureCategory;
  readonly httpStatus: number;
  readonly publicCode: string;
  readonly radarLedgerReason: string;
  readonly retriable: boolean;
}

export const FAILURE_PROJECTIONS: readonly FailureProjection[] = [
  {
    category: 'provider_unavailable', httpStatus: 503,
    publicCode: 'capability_unavailable', radarLedgerReason: 'provider_unavailable',
    retriable: true,
  },
  {
    category: 'conflict', httpStatus: 409,
    publicCode: 'conflict', radarLedgerReason: 'provider_conflict',
    retriable: false,
  },
  {
    category: 'unauthorized_at_commit', httpStatus: 403,
    publicCode: 'access_denied', radarLedgerReason: 'unauthorized_at_commit',
    retriable: false,
  },
  {
    category: 'provider_error', httpStatus: 500,
    publicCode: 'internal_error', radarLedgerReason: 'provider_error',
    retriable: false,
  },
] as const;

/** Classified internal failure with private cause and commit state. */
export interface ArtifactFailure {
  readonly category: FailureCategory;
  readonly httpStatus: number;
  readonly publicCode: string;
  readonly retriable: boolean;
  readonly invocationId: string;
  readonly operation: string;
  readonly phase: string;
  readonly commitState: CommitState;
  readonly cause: unknown;
}

/** Internal discriminated outcome shared by HTTP and MCP projections. */
export type ArtifactOutcome<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly failure: ArtifactFailure };
