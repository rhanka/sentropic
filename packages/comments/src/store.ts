import type { TenantContext } from '@sentropic/contracts';

import type {
  Comment,
  CommentThreadSummary,
  NewComment,
  TargetQuery,
} from './types.js';

/**
 * Tenant-scoped comment persistence port. Every signature carries a
 * `TenantContext` (cross-tenant access is mitigated by scoping every call).
 * Adapters (in-memory here; Postgres in the host) implement this contract.
 *
 * Semantics (mirroring the live app, see SPEC §3):
 * - `add` mints a `threadId` when `input.threadId` is absent (root), else
 *   validates the referenced thread exists in the same tenant + target.
 * - `edit` is a PER-ROW content edit (no cascade).
 * - `delete` is a PER-ROW HARD delete (deleting the root leaves surviving
 *   replies; the thread identity is the surviving set of rows).
 * - `setState` and `assign` CASCADE across every row sharing the `threadId`.
 * - `listByTarget` / `listThread` order by `createdAt ASC` with an `id ASC`
 *   tiebreaker (deterministic; live `createdAt` is not unique).
 * - The store emits a wire event on every mutation via the injected sink.
 */
export interface CommentStore {
  /** Create a comment; mints a thread when `input.threadId` is absent. */
  add(tenant: TenantContext, input: NewComment): Promise<Comment>;

  /** Fetch one comment by id, scoped to the tenant. */
  get(tenant: TenantContext, id: string): Promise<Comment | null>;

  /** Per-row content edit (no cascade). */
  edit(
    tenant: TenantContext,
    id: string,
    patch: { body?: string },
  ): Promise<Comment>;

  /** Per-row HARD delete. Deleting the root leaves surviving replies. */
  delete(tenant: TenantContext, id: string): Promise<void>;

  /** List comments anchored to a target; ordered createdAt ASC, id tiebreaker. */
  listByTarget(
    tenant: TenantContext,
    query: TargetQuery,
  ): Promise<Comment[]>;

  /** List a single thread's rows; ordered createdAt ASC, id tiebreaker. */
  listThread(tenant: TenantContext, threadId: string): Promise<Comment[]>;

  /** Thread summaries for a target (feeds the host AI resolution assistant). */
  listThreadSummaries(
    tenant: TenantContext,
    query: TargetQuery,
  ): Promise<CommentThreadSummary[]>;

  /** Cascade open/resolved across all rows of the thread. */
  setState(
    tenant: TenantContext,
    threadId: string,
    state: 'open' | 'resolved',
  ): Promise<Comment[]>;

  /** Cascade assignment across all rows of the thread (`null` to unassign). */
  assign(
    tenant: TenantContext,
    threadId: string,
    assigneeId: string | null,
  ): Promise<Comment[]>;
}

/** Thrown when a reply references a thread that does not exist in scope. */
export class ThreadNotFoundError extends Error {
  constructor(public readonly threadId: string) {
    super(`Thread not found: ${threadId}`);
    this.name = 'ThreadNotFoundError';
  }
}

/** Thrown when a comment id does not exist in scope. */
export class CommentNotFoundError extends Error {
  constructor(public readonly commentId: string) {
    super(`Comment not found: ${commentId}`);
    this.name = 'CommentNotFoundError';
  }
}
