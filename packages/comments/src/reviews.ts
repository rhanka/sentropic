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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const validateReviewAudit = (
  input: Omit<ReviewEventRecord, 'kind' | 'link' | 'hash'>,
): void => {
  if (input.actor.principal.length === 0) {
    throw new ReviewValidationError('invalid-audit', 'Review actor principal is required');
  }
  if (input.decision !== null) {
    if (!isNonEmptyString(input.decision.principal) || !isReviewDecisionOutcome(input.decision.outcome)) {
      throw new ReviewValidationError('invalid-audit', 'Decision audit needs a principal and a closed outcome');
    }
  }
  if (input.proposal !== null && (!isNonEmptyString(input.proposal.agent) || !isNonEmptyString(input.proposal.proposalDigest))) {
    throw new ReviewValidationError('invalid-audit', 'Proposal audit needs an agent and an exact digest');
  }
  if (input.executor !== null && (!isNonEmptyString(input.executor.service) || !isNonEmptyString(input.executor.run))) {
    throw new ReviewValidationError('invalid-audit', 'Executor audit needs a service and a run');
  }
};

/**
 * Create a review event appended to the chain of one scoped annotation. The
 * chain is one hash chain per (scope, annotationId) across all annotation
 * revisions; the new event pins the exact revision it applies to. A contest
 * must reference a validation of that same revision, a resolution must
 * reference an open contest, and sequencing is enforced against the
 * conservative per-revision state machine.
 */
export const createReviewEvent = (
  chain: readonly ReviewEventRecord[],
  input: Omit<ReviewEventRecord, 'kind' | 'link' | 'hash'>,
): ReviewEventRecord => {
  if (!isReviewAction(input.action)) {
    throw new ReviewValidationError('invalid-action', `Unknown review action: ${String(input.action)}`);
  }
  if (!isNonEmptyString(input.annotationId) || !isNonEmptyString(input.revisionHash)) {
    throw new ReviewValidationError('invalid-pin', 'Review needs an annotation id and an exact revision hash');
  }
  validateReviewAudit(input);
  const previous = chain.length > 0 ? chain[chain.length - 1] : null;
  if (previous !== null && (previous.annotationId !== input.annotationId || previous.scope.tenantId !== input.scope.tenantId || previous.scope.workspaceId !== input.scope.workspaceId)) {
    throw new ReviewValidationError('invalid-sequence', 'Review chain is scoped to one annotation');
  }
  const { state, contests } = projectRevisionReview(chain, input.revisionHash);
  const openContest = contests.some((contest) => contest.resolvedByEventHash === null);
  if (input.action === 'submit') {
    if (state !== 'none' && state !== 'withdrawn') {
      throw new ReviewValidationError('invalid-sequence', 'This revision already has an open review');
    }
    if (input.referencesEventHash !== null) {
      throw new ReviewValidationError('invalid-reference', 'submit carries no referenced event');
    }
  } else if (input.action === 'validate') {
    if (state !== 'submitted' && !(state === 'contested' && !openContest)) {
      throw new ReviewValidationError('invalid-sequence', 'Validation requires an open submission or a fully resolved contest');
    }
    if (input.referencesEventHash !== null) {
      throw new ReviewValidationError('invalid-reference', 'validate carries no referenced event');
    }
    if (input.decision === null) {
      throw new ReviewValidationError('invalid-audit', 'Validation requires a human decision audit');
    }
  } else if (input.action === 'contest') {
    if (state !== 'validated') {
      throw new ReviewValidationError('invalid-sequence', 'Only a validated revision can be contested');
    }
    if (!isNonEmptyString(input.referencesEventHash) || !chain.some((event) => event.hash === input.referencesEventHash && event.action === 'validate' && event.revisionHash === input.revisionHash)) {
      throw new ReviewValidationError('invalid-reference', 'Contest must reference a validation of the same revision');
    }
  } else if (input.action === 'resolve-contest') {
    if (!contests.some((contest) => contest.eventHash === input.referencesEventHash && contest.resolvedByEventHash === null)) {
      throw new ReviewValidationError('invalid-reference', 'Resolution must reference an open contest');
    }
    if (input.decision === null) {
      throw new ReviewValidationError('invalid-audit', 'Resolution requires a human decision audit');
    }
  } else {
    if (state !== 'submitted' && state !== 'contested') {
      throw new ReviewValidationError('invalid-sequence', 'Only an open review can be withdrawn');
    }
    if (input.referencesEventHash !== null) {
      throw new ReviewValidationError('invalid-reference', 'withdraw carries no referenced event');
    }
  }
  const link = { sequence: previous === null ? 1 : previous.link.sequence + 1, previousHash: previous === null ? null : previous.hash };
  const envelope = { ...input, link };
  const hash = hashRecord('review-event', envelope as unknown as Record<string, unknown>);
  return { ...envelope, kind: 'review-event', hash };
};

/**
 * Conservative review projection over one annotation's event chain. Events
 * pinned to a revision other than the annotation's current head stay visible
 * as stale history and apply nothing; a fully resolved contest still requires
 * renewed validation before the head revision counts as validated.
 */
export type ReviewProjection = {
  readonly state: ReviewState;
  readonly contests: readonly ContestView[];
  readonly requiresRenewedValidation: boolean;
  readonly staleEventHashes: readonly string[];
};

export const projectReviewState = (
  chain: readonly ReviewEventRecord[],
  currentRevisionHash: string | null,
): ReviewProjection => {
  if (currentRevisionHash === null) {
    return { state: 'none', contests: [], requiresRenewedValidation: false, staleEventHashes: chain.map((event) => event.hash) };
  }
  const stale = chain.filter((event) => event.revisionHash !== currentRevisionHash);
  const applicable = chain.filter((event) => event.revisionHash === currentRevisionHash);
  const { state, contests } = projectRevisionReview(applicable, currentRevisionHash);
  return {
    state,
    contests,
    requiresRenewedValidation:
      state === 'contested' && contests.length > 0 && contests.every((contest) => contest.resolvedByEventHash !== null),
    staleEventHashes: stale.map((event) => event.hash),
  };
};
