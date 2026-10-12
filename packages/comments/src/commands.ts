/**
 * Canonical command contracts (SPEC §4.4, §5): capabilities with default
 * denial, idempotency with CAS, and G4 human-decision binding without
 * circular output hashes.
 */

import type { IdempotencyKey } from '@sentropic/contracts';
import { idempotencyKey } from '@sentropic/contracts';
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';
import type { ResourceRef } from './anchors.js';
import type { ResolverOutcome } from './anchors.js';

/** Host-granted capabilities (SPEC §5); creator/admin permission never confers review rights. */
export const COMMAND_CAPABILITIES = [
  'read',
  'comment',
  'revise',
  'assign',
  'resolve-discussion',
  'review',
  'contest',
  'resolve-contest',
  'shared-archive',
  'shared-restore',
  'personal-archive',
  'tombstone',
  'purge',
  'submit-to-ai',
] as const;

export type CommandCapability = (typeof COMMAND_CAPABILITIES)[number];

export const isCommandCapability = (value: unknown): value is CommandCapability =>
  typeof value === 'string' && (COMMAND_CAPABILITIES as readonly string[]).includes(value);

/** Host-injected capability check; unconfigured capabilities deny by default. */
export type CapabilityCheckPort = {
  check(principal: string, capability: CommandCapability, targets: readonly ResourceRef[]): Promise<boolean>;
};

/** Denying capability check used when a host injects no policy. */
export const defaultDenyCapabilityCheck: CapabilityCheckPort = {
  check: async () => false,
};

/** Host resource/version resolver with explicit outcomes only. */
export type ResourceResolverPort = {
  resolve(principal: string, resource: ResourceRef): Promise<ResolverOutcome>;
};

/** Command error with a closed reason code (SPEC §5: 401/403/404/409/400 analogues). */
export class CanonicalCommandError extends Error {
  constructor(
    public readonly code:
      | 'cas-conflict'
      | 'idempotency-conflict'
      | 'denied'
      | 'invalid-command'
      | 'not-found',
    message: string,
  ) {
    super(message);
    this.name = 'CanonicalCommandError';
  }
}

/** Expected state for CAS: an exact head revision, or creation with an aggregate version. */
export type ExpectedState =
  | { readonly kind: 'revision'; readonly revisionHash: string }
  | { readonly kind: 'creation'; readonly aggregateVersion: number };

/** Authenticated principal issuing a command. */
export type CommandActor = { readonly principal: string };

/** Canonical command envelope: every state-changing command carries scope, idempotency key and expected state. */
export type CanonicalCommandEnvelope<TPayload> = {
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly idempotencyKey: IdempotencyKey;
  readonly expected: ExpectedState;
  readonly actor: CommandActor;
  readonly payload: TPayload;
};

/** Validate and brand an idempotency key; keys are non-empty strings. */
export const commandIdempotencyKey = (raw: string): IdempotencyKey => {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new CanonicalCommandError('invalid-command', 'Idempotency key must be a non-empty string');
  }
  return idempotencyKey(raw);
};

/**
 * G4 decision evidence returned by the injected decision-resolution port. For
 * review of an existing revision it binds that exact revision/hash. For a
 * revision-creating action it binds the expected base (revision or explicit
 * absence plus expected aggregate version) and the digest of the proposed
 * content — never the future output hash.
 */
export type DecisionEvidence = {
  readonly actor: string;
  readonly action: string;
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly issuedAt: number;
  /** Explicit absence of expiry is null, not an omitted field. */
  readonly expiresAt: number | null;
  readonly revoked: boolean;
  readonly revocationVersion: number;
  readonly authority: string;
  readonly binding:
    | { readonly kind: 'existing-revision'; readonly revisionHash: string }
    | { readonly kind: 'creation'; readonly aggregateVersion: number; readonly proposedContentDigest: string };
};

export type DecisionResolutionPort = {
  resolve(decisionRef: string): Promise<DecisionEvidence | null>;
};

/**
 * Compute the G4 proposed-content digest over the proposed immutable
 * content/anchor/geometry/profile fields. Server-assigned registration, the
 * output revision hash and the decision/executor envelope are excluded, so no
 * decision ever refers to its own future output hash.
 */
export const computeProposedContentDigest = (proposal: Record<string, unknown>): string =>
  sha256Hex(canonicalJson(proposal));

/** A committed command result recorded in the idempotency index. */
export type CommittedCommand = {
  readonly digest: string;
  readonly resultIds: readonly string[];
  readonly resultHash: string | null;
};

/** Digest of a command payload for replay comparison. */
export const commandPayloadDigest = (payload: unknown): string => sha256Hex(canonicalJson(payload));

/**
 * Idempotency replay rule: reusing a committed key with the same payload
 * digest returns the committed identifiers; a different payload digest is a
 * conflict, never a silent second execution.
 */
export const resolveIdempotentReplay = (
  committed: CommittedCommand,
  requestedDigest: string,
): { readonly replay: true; readonly result: CommittedCommand } => {
  if (committed.digest !== requestedDigest) {
    throw new CanonicalCommandError(
      'idempotency-conflict',
      'Idempotency key reused with different content',
    );
  }
  return { replay: true, result: committed };
};

/**
 * G4 execution check: the decision must exist, be unrevoked, unexpired, match
 * the actor/scope/action and bind the exact base and proposed-content digest.
 * Missing or mismatched evidence denies the action; retry cannot invent one.
 */
export const checkDecisionEvidence = (
  evidence: DecisionEvidence | null,
  expected: {
    readonly actor: string;
    readonly action: string;
    readonly scope: { readonly tenantId: string; readonly workspaceId: string };
    readonly now: number;
    readonly binding: DecisionEvidence['binding'];
  },
): DecisionEvidence => {
  if (evidence === null) {
    throw new CanonicalCommandError('denied', 'No decision evidence resolved');
  }
  if (
    evidence.revoked ||
    (evidence.expiresAt !== null && evidence.expiresAt < expected.now) ||
    evidence.actor !== expected.actor ||
    evidence.action !== expected.action ||
    evidence.scope.tenantId !== expected.scope.tenantId ||
    evidence.scope.workspaceId !== expected.scope.workspaceId
  ) {
    throw new CanonicalCommandError('denied', 'Decision evidence is revoked, expired or mismatched');
  }
  const bound = evidence.binding;
  const want = expected.binding;
  if (bound.kind !== want.kind) {
    throw new CanonicalCommandError('denied', 'Decision binding kind mismatch');
  }
  if (bound.kind === 'existing-revision' && want.kind === 'existing-revision' && bound.revisionHash !== want.revisionHash) {
    throw new CanonicalCommandError('denied', 'Decision revision binding mismatch');
  }
  if (
    bound.kind === 'creation' &&
    want.kind === 'creation' &&
    (bound.aggregateVersion !== want.aggregateVersion || bound.proposedContentDigest !== want.proposedContentDigest)
  ) {
    throw new CanonicalCommandError('denied', 'Decision creation binding mismatch');
  }
  return evidence;
};
