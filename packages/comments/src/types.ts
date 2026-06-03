import type { TenantContext } from '@sentropic/contracts';

/**
 * The kind of artifact a comment is anchored to.
 *
 * `record` is the generic bucket the live `contextType` values
 * (organization | folder | initiative | matrix | executive_summary) map into;
 * `field` narrows a record to a single sub-field via `sectionKey`.
 * `message | canvas | artifact` are the new annotation target kinds.
 */
export type CommentTargetKind =
  | 'message'
  | 'canvas'
  | 'artifact'
  | 'field'
  | 'record';

/**
 * Where a comment thread is anchored. Generalises the live
 * `{ contextType, contextId, sectionKey }` triple WITHOUT LOSS — see the
 * round-trip table in the README and `targetFromLive`/`targetToLive`.
 */
export type CommentTarget = {
  kind: CommentTargetKind;
  /** contextId / messageId / docId / artifactId. */
  id: string;
  /**
   * Preserved verbatim from the live column: 'description',
   * 'matrix.cell.x.y', a livedoc range, or a field path. Optional on every
   * target kind.
   */
  sectionKey?: string;
  /**
   * When `kind === 'record' | 'field'`: the live host record kind
   * (organization | folder | initiative | matrix | executive_summary).
   * Opaque string — the package never enumerates host record kinds.
   */
  recordType?: string;
};

/**
 * Opaque host identity reference. The package never resolves it
 * (users.id today; BR-39 unified identity later).
 */
export type CommentAuthor = {
  id: string;
  /** Forward-compat with unified identities; defaults to 'human'. */
  kind?: 'human' | 'agent' | 'nhi';
  /** Host-supplied denormalised label; the package does not join users. */
  displayLabel?: string;
};

/** Package state vocabulary; maps the live `open | closed` 1:1. */
export type CommentState = 'open' | 'resolved';

/** Provenance linking a comment to an AI tool call / run (message/canvas origin). */
export type CommentProvenance = {
  toolCallId?: string;
  runId?: string;
};

/** A single comment row. The thread is the flat set of rows sharing `threadId`. */
export type Comment = {
  id: string;
  /** Transverse tenant context; carries tenantId / workspaceId / userId. */
  tenant: TenantContext;
  target: CommentTarget;
  /** Root mints; replies inherit. Flat model — no parentId. */
  threadId: string;
  author: CommentAuthor;
  /** Opaque id; host validates membership. `null`/absent means unassigned. */
  assignedTo?: string;
  state: CommentState;
  body: string;
  provenance?: CommentProvenance;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt?: string;
};

/**
 * Input to create a comment. `Comment` minus the store-minted fields, plus an
 * optional `threadId` for replies (absent => mint a new thread / root row).
 */
export type NewComment = {
  tenant: TenantContext;
  target: CommentTarget;
  author: CommentAuthor;
  body: string;
  /** Present => reply to an existing thread; absent => mint a new root thread. */
  threadId?: string;
  assignedTo?: string;
  provenance?: CommentProvenance;
};

/** Filter for `listByTarget` / `listThreadSummaries` (mirrors the live list query). */
export type TargetQuery = {
  kind: CommentTargetKind;
  id: string;
  sectionKey?: string;
  status?: CommentState;
};

/**
 * Thread summary surface (Decision D9). Field names are VERBATIM from the live
 * AI resolution assistant so the host rebuilds it without re-deriving names.
 */
export type CommentThreadSummary = {
  threadId: string;
  /** = target.recordType (live drop-in compat). */
  contextType?: string;
  /** Canonical generalised target. */
  target: CommentTarget;
  /** = target.sectionKey (live: row.sectionKey ?? null). */
  sectionKey?: string;
  /** Live: root row content. */
  rootMessage: string;
  /** ISO; live: root createdAt. */
  rootMessageAt: string;
  /** Live: latest row content. */
  lastMessage: string;
  /** ISO; live: latest createdAt. */
  lastMessageAt: string;
  messageCount: number;
  status: CommentState;
  /** Live: assignedTo ?? null — opaque id, not resolved to a label. */
  assignee?: string;
};

/** The five live `contextType` values that round-trip through `kind: 'record'`. */
export const LIVE_RECORD_CONTEXT_TYPES = [
  'organization',
  'folder',
  'initiative',
  'matrix',
  'executive_summary',
] as const;

/** Live comment row shape (host side) for explicit lossless round-trips. */
export type LiveCommentTarget = {
  contextType: string;
  contextId: string;
  sectionKey: string | null;
};

/**
 * Live -> package: maps `{ contextType, contextId, sectionKey }` to a
 * `CommentTarget` with `kind: 'record'` + `recordType`, preserving `sectionKey`.
 */
export const targetFromLive = (live: LiveCommentTarget): CommentTarget => {
  const target: CommentTarget = {
    kind: 'record',
    id: live.contextId,
    recordType: live.contextType,
  };
  if (live.sectionKey !== null && live.sectionKey !== undefined) {
    target.sectionKey = live.sectionKey;
  }
  return target;
};

/**
 * Package -> live: inverse of `targetFromLive`. `recordType` becomes
 * `contextType`; a missing `sectionKey` becomes `null` (live column is nullable).
 */
export const targetToLive = (target: CommentTarget): LiveCommentTarget => ({
  contextType: target.recordType ?? target.kind,
  contextId: target.id,
  sectionKey: target.sectionKey ?? null,
});
