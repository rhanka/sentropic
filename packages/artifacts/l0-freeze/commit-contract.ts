/**
 * L0 frozen commit declaration (immo #861, ask 2 shape only).
 *
 * Stable data shapes for request-bound invocation context, the typed
 * authorization decision and the atomic finalization unit. The coordinator
 * role and the host binding names stay unfrozen until spec r2; L3 wires
 * the transaction-bound implementation against these shapes.
 */

import type { CommandIdentity } from './command-identity-contract.js';

/** Outcome of a COMMIT acknowledgment wait. */
export const COMMIT_STATES = ['not_committed', 'committed', 'unknown'] as const;

export type CommitState = (typeof COMMIT_STATES)[number];

/**
 * Immutable request-bound invocation context. Neither body fields nor
 * mutable app-global state may supply it; the provider invokes the host
 * guard with this same guarded transaction after all waits.
 */
export interface InvocationContext {
  readonly invocationId: string;
  readonly actor: string;
  readonly operation: string;
  readonly storageScopeId: string;
  readonly objectIdentity: string;
  readonly commandIdentity: CommandIdentity;
  readonly policyRevision: string;
}

/**
 * Typed authorization decision. Never an unqualified boolean: an allowed
 * decision carries a usable guarded revision/fence, a denial carries a
 * typed reason. Entry rejection stays distinguishable from a refusal
 * raised inside finalization.
 */
export type AuthorizationDecision =
  | { readonly allowed: true; readonly guardedRevision: string; readonly fence: string }
  | { readonly allowed: false; readonly reason: 'denied' | 'revoked' | 'expired' | 'invalid_object' | 'unavailable' };

/**
 * Frozen finalization order (ask 2, protocol A4). The host guard runs
 * after lock, connection and object waits, inside the finalization
 * boundary, before any committed success.
 */
export const FINALIZATION_PHASES = [
  'admit', 'prepare', 'lock', 'provision', 'guard', 'commit',
] as const;

export type FinalizationPhase = (typeof FINALIZATION_PHASES)[number];

/**
 * Residue a refused finalization must never leave committed: no new
 * ready release, pointer advance, attached provenance, ACL/binding or
 * lifecycle change, consumed quota or replayable success.
 */
export const REFUSAL_RESIDUE_FORBIDDEN = [
  'ready-release', 'pointer-advance', 'attached-provenance',
  'acl-binding-change', 'lifecycle-change', 'consumed-quota', 'replayable-success',
] as const;

export type RefusalResidue = (typeof REFUSAL_RESIDUE_FORBIDDEN)[number];

/** Profiles requiring guarded writes must declare a coordinator at startup. */
export interface CoordinatorRequirement {
  readonly requiresCoordinator: true;
  readonly guardedOperations: readonly string[];
}
