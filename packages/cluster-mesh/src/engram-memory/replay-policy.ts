// engram-memory P3 commit-identity replay policy: the journal `event_id`
// is the single-event commit identity. Lookup precedes append, the same
// intent reuses the event and result, a different intent conflicts.
// Data-pure: the backend supplies the committed map, this module decides.

import { errResult, okResult, type ValidationResult } from '../storage/contracts.js';

export interface MemoryCommitIdentity {
  readonly eventId: string;
  readonly intentHash: string;
}

export type MemoryReplayDecision =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'reuse'; readonly eventId: string }
  | { readonly kind: 'conflict'; readonly eventId: string };

/**
 * Classify an apply intent against commits already issued in this scope.
 * Same event with the same intent reuses the original result without a
 * new event or cursor; the same event with a changed intent conflicts
 * before any effect. Multiple `apply` contributions share one
 * transaction and commit identity.
 */
export const classifyCommitReplay = (
  committed: Readonly<Record<string, string>>,
  intent: MemoryCommitIdentity,
): MemoryReplayDecision => {
  if (typeof intent.eventId !== 'string' || intent.eventId.length === 0) {
    throw new Error('commit intent requires a non-empty eventId');
  }
  const recorded = committed[intent.eventId];
  if (recorded === undefined) return { kind: 'proceed' };
  if (recorded === intent.intentHash) return { kind: 'reuse', eventId: intent.eventId };
  return { kind: 'conflict', eventId: intent.eventId };
};

/** A conflicting intent must fail without writes, never overwrite. */
export const validateCommitReplay = (
  committed: Readonly<Record<string, string>>,
  intent: MemoryCommitIdentity,
): ValidationResult => {
  const decision = classifyCommitReplay(committed, intent);
  if (decision.kind === 'conflict') return errResult(`commit identity ${intent.eventId} already carries a different intent`);
  return okResult();
};
