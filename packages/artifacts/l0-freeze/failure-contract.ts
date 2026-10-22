/**
 * L0 frozen failure declaration (immo #861, ask 3 shape, spec r2 E2/E3).
 *
 * Stable internal outcome shape and category-to-public projection table.
 * `capability_unselected` is a distinct pre-dispatch non-retriable 503
 * with no write-ledger entry; the guard authority outage shares the
 * commit category and ledger reason with policy denial but projects a
 * retriable same-key 503. Driver detail stays in the private cause and
 * never enters HTTP bodies, MCP results or metadata. The classifier and
 * success replay flag land in L2.
 */

import type { CommitState } from './commit-contract.js';

/**
 * Internal failure categories, distinct from ordinary typed
 * validation/not-found/gone outcomes whose existing public mappings
 * remain supported.
 */
export const FAILURE_CATEGORIES = [
  'capability_unselected', 'provider_unavailable', 'conflict',
  'unauthorized_at_commit', 'provider_error',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * Frozen category-to-public projection (ask 3, table E2). `variant`
 * selects the projection row inside one category. An absent
 * `radarLedgerReason` means the rejection happens before dispatch and
 * creates no write-commit ledger entry. `phase`/`commitState` are the
 * projection defaults; the per-incident phase travels on ArtifactFailure.
 */
export interface FailureProjection {
  readonly category: FailureCategory;
  readonly variant?: string;
  readonly httpStatus: number;
  readonly publicCode: string;
  readonly radarLedgerReason?: string;
  readonly retriable: boolean;
  readonly phase: string;
  readonly commitState: CommitState;
}

export const FAILURE_PROJECTIONS: readonly FailureProjection[] = [
  {
    category: 'capability_unselected', variant: 'unselected_operation',
    httpStatus: 503, publicCode: 'capability_unavailable',
    retriable: false, phase: 'selection', commitState: 'not_committed',
  },
  {
    category: 'provider_unavailable', variant: 'dispatch_failure',
    httpStatus: 503, publicCode: 'capability_unavailable',
    radarLedgerReason: 'provider_unavailable',
    retriable: true, phase: 'dispatch', commitState: 'not_committed',
  },
  {
    category: 'conflict', variant: 'key_contention',
    httpStatus: 409, publicCode: 'conflict',
    radarLedgerReason: 'provider_conflict',
    retriable: false, phase: 'lock', commitState: 'not_committed',
  },
  {
    category: 'unauthorized_at_commit', variant: 'policy_denial',
    httpStatus: 403, publicCode: 'access_denied',
    radarLedgerReason: 'unauthorized_at_commit',
    retriable: false, phase: 'guard', commitState: 'not_committed',
  },
  {
    category: 'unauthorized_at_commit', variant: 'authority_unavailable',
    httpStatus: 503, publicCode: 'capability_unavailable',
    radarLedgerReason: 'unauthorized_at_commit',
    retriable: true, phase: 'guard', commitState: 'not_committed',
  },
  {
    category: 'provider_error', variant: 'unclassified',
    httpStatus: 500, publicCode: 'internal_error',
    radarLedgerReason: 'provider_error',
    retriable: false, phase: 'operation', commitState: 'not_committed',
  },
] as const;

/** Classified internal failure with private cause and commit state. */
export interface ArtifactFailure {
  readonly category: FailureCategory;
  readonly variant?: string;
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
