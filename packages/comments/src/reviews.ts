/**
 * Canonical review and contest contracts (SPEC §4.4, G3).
 *
 * Review events form one hash chain per (scope, annotationId) across every
 * annotation revision. Each event pins the exact annotation revision it applies
 * to, a contest references the validation it contests and a resolution
 * references the contest it resolves. The state machine below is deliberately
 * conservative: there is no mutable `validated` boolean, a resolved contest
 * still requires a renewed validation before the revision counts as validated
 * again, and resolved contests stay visible in the projected history.
 */

import { hashRecord } from './revision-hash.js';
import type { CanonicalStoreScope } from './command-store.js';

/** Closed review-action set: submission, validation, contest, resolution, withdrawal. */
export const REVIEW_ACTIONS = [
  'submit',
  'validate',
  'contest',
  'resolve-contest',
  'withdraw',
] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const isReviewAction = (value: unknown): value is ReviewAction =>
  typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value);

/** Closed human-decision outcomes, audited separately from actor and executor. */
export const REVIEW_DECISION_OUTCOMES = ['accept', 'reject', 'abstain'] as const;

export type ReviewDecisionOutcome = (typeof REVIEW_DECISION_OUTCOMES)[number];

export const isReviewDecisionOutcome = (value: unknown): value is ReviewDecisionOutcome =>
  typeof value === 'string' && (REVIEW_DECISION_OUTCOMES as readonly string[]).includes(value);

/** Human decision audit: deciding principal plus closed outcome. */
export type ReviewDecisionAudit = {
  readonly principal: string;
  readonly outcome: ReviewDecisionOutcome;
};

/** Optional agent proposal audit: proposal identity plus exact content digest. */
export type ReviewAgentProposal = {
  readonly agent: string;
  readonly proposalDigest: string;
};

/** Executor audit: service and run identity, separate from decision and proposal. */
export type ReviewExecutorAudit = {
  readonly service: string;
  readonly run: string;
};

/** Review validation error with a closed reason code. */
export class ReviewValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid-action'
      | 'invalid-pin'
      | 'invalid-reference'
      | 'invalid-sequence'
      | 'invalid-audit',
    message: string,
  ) {
    super(message);
    this.name = 'ReviewValidationError';
  }
}

/** One contest of a validation, kept visible after resolution. */
export type ContestView = {
  /** Contest event hash, the contested validate event hash, and the resolving event hash when resolved. */
  readonly eventHash: string;
  readonly contestsEventHash: string;
  resolvedByEventHash: string | null;
};

/** Conservative per-revision review state; never hashed, never persisted as a flag. */
export type ReviewState = 'none' | 'submitted' | 'validated' | 'contested' | 'withdrawn';

/** Immutable review event (hashed record kind `review-event`). */
export type ReviewEventRecord = {
  readonly kind: 'review-event';
  readonly scope: CanonicalStoreScope;
  readonly annotationId: string;
  readonly link: { readonly sequence: number; readonly previousHash: string | null };
  readonly action: ReviewAction;
  /** Exact annotation revision this event applies to; no latest substitution. */
  readonly revisionHash: string;
  /** Contested validation / resolved contest event hash, null otherwise. */
  readonly referencesEventHash: string | null;
  readonly actor: { readonly principal: string };
  /** Human decision audit, required for validate and resolve-contest. */
  readonly decision: ReviewDecisionAudit | null;
  /** Optional agent proposal audit; never replaces the human decision. */
  readonly proposal: ReviewAgentProposal | null;
  /** Executor/service/run audit, separate from decision and proposal. */
  readonly executor: ReviewExecutorAudit | null;
  readonly hash: string;
};

/**
 * Replay the conservative state machine over the events already chained for
 * one annotation revision. `contested` survives a resolution: only a later
 * validate event re-establishes `validated` (renewed validation).
 */
export const projectRevisionReview = (
  events: readonly ReviewEventRecord[],
  revisionHash: string,
): { readonly state: ReviewState; readonly contests: readonly ContestView[] } => {
  let state: ReviewState = 'none';
  const contests: ContestView[] = [];
  for (const event of events) {
    if (event.revisionHash !== revisionHash) {
      continue;
    }
    switch (event.action) {
      case 'submit':
        state = 'submitted';
        break;
      case 'validate':
        state = 'validated';
        break;
      case 'contest':
        state = 'contested';
        contests.push({
          eventHash: event.hash,
          contestsEventHash: event.referencesEventHash as string,
          resolvedByEventHash: null,
        });
        break;
      case 'resolve-contest': {
        const open = contests.find(
          (contest) => contest.eventHash === event.referencesEventHash && contest.resolvedByEventHash === null,
        );
        if (open !== undefined) {
          open.resolvedByEventHash = event.hash;
        }
        state = 'contested';
        break;
      }
      case 'withdraw':
        state = 'withdrawn';
        break;
    }
  }
  return { state, contests };
};
