import { and, asc, eq } from 'drizzle-orm';
import type { TenantContext } from '@sentropic/contracts';
import {
  CommentNotFoundError,
  ThreadNotFoundError,
  targetFromLive,
  targetToLive,
  type Comment,
  type CommentState,
  type CommentStore,
  type CommentThreadSummary,
  type NewComment,
  type TargetQuery,
} from '@sentropic/comments';

import { db as defaultDb } from '../../db/client';
import { comments, type CommentRow } from '../../db/schema';
import { createId as defaultCreateId } from '../../utils/id';

/**
 * Drizzle-backed `CommentStore` over the EXISTING live `comments` table
 * (`schema.ts:646-671`). REUSE, no parallel table (SPEC §2, DEC-2).
 *
 * PERSISTENCE-ONLY / EMIT-FREE (SPEC §2/§4, v3 host-controlled emission):
 * unlike `InMemoryCommentStore` — whose `add`/`edit`/`delete`/`setState`/`assign`
 * call an injected sink internally — this adapter NEVER emits a wire event and
 * NEVER imports `pg`'s NOTIFY. It only persists via the injected Drizzle `db`
 * and returns the mutated row(s). Wire-event emission is owned by each call site
 * (REST route / AI tool-service / queue auto path), which emits the explicit
 * `{action, key}` descriptor through the app-local `PgNotifyCommentEventSink`
 * (Lot 3/4/5). This decoupling keeps composite host operations (POST-with-assignee,
 * PATCH-with-assignment) single-event.
 *
 * Tenancy (SPEC §1 L12 / GAP-D): maps `tenant.workspaceId -> comments.workspace_id`
 * and IGNORES `tenant.tenantId` (live convention `tenantId := workspaceId`,
 * `catalog.ts:32`). No `tenant_id` column exists -> ZERO migration.
 *
 * Provenance (SPEC §1 L11 / must-fix #7): persists `provenance.toolCallId <->
 * comments.toolCallId`; DROPS `provenance.runId` (no `run_id` column).
 *
 * Ordering: `createdAt ASC, id ASC` (deterministic; strict refinement of the
 * live `asc(createdAt)` — live `createdAt` is not unique).
 */
export type PgCommentStoreOptions = {
  /** Drizzle client (defaults to the app `db`). */
  db?: typeof defaultDb;
  /** Id generator (defaults to `api/src/utils/id` = `randomUUID()`). */
  createId?: () => string;
};

export class PgCommentStore implements CommentStore {
  private readonly db: typeof defaultDb;
  private readonly createId: () => string;

  constructor(options: PgCommentStoreOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.createId = options.createId ?? defaultCreateId;
  }

  async add(tenant: TenantContext, input: NewComment): Promise<Comment> {
    const workspaceId = tenant.workspaceId;
    const live = targetToLive(input.target);

    let threadId = input.threadId;
    if (threadId !== undefined) {
      // Validate the referenced thread exists in the same tenant + target
      // (mirrors comments.ts:158-170).
      const [existing] = await this.db
        .select({ id: comments.id })
        .from(comments)
        .where(
          and(
            eq(comments.workspaceId, workspaceId),
            eq(comments.contextType, live.contextType),
            eq(comments.contextId, live.contextId),
            eq(comments.threadId, threadId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new ThreadNotFoundError(threadId);
      }
    } else {
      threadId = this.createId();
    }

    const id = this.createId();
    const now = new Date();
    await this.db.insert(comments).values({
      id,
      workspaceId,
      contextType: live.contextType,
      contextId: live.contextId,
      sectionKey: live.sectionKey,
      createdBy: input.author.id,
      assignedTo: input.assignedTo ?? null,
      status: 'open',
      threadId,
      content: input.body,
      // DROP provenance.runId (no column); persist toolCallId only.
      toolCallId: input.provenance?.toolCallId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const row = await this.requireRow(workspaceId, id);
    return this.toComment(tenant, row);
  }

  async get(tenant: TenantContext, id: string): Promise<Comment | null> {
    const row = await this.selectRow(tenant.workspaceId, id);
    return row ? this.toComment(tenant, row) : null;
  }

  async edit(
    tenant: TenantContext,
    id: string,
    patch: { body?: string },
  ): Promise<Comment> {
    const workspaceId = tenant.workspaceId;
    const existing = await this.selectRow(workspaceId, id);
    if (!existing) {
      throw new CommentNotFoundError(id);
    }
    // PER-ROW content edit (mirrors comments.ts:251-252). No cascade.
    const set: { content?: string; updatedAt: Date } = { updatedAt: new Date() };
    if (patch.body !== undefined) {
      set.content = patch.body;
    }
    await this.db
      .update(comments)
      .set(set)
      .where(and(eq(comments.id, id), eq(comments.workspaceId, workspaceId)));

    const row = await this.requireRow(workspaceId, id);
    return this.toComment(tenant, row);
  }

  async delete(tenant: TenantContext, id: string): Promise<void> {
    const workspaceId = tenant.workspaceId;
    const existing = await this.selectRow(workspaceId, id);
    if (!existing) {
      throw new CommentNotFoundError(id);
    }
    // PER-ROW HARD delete (mirrors comments.ts:336). Replies survive.
    await this.db
      .delete(comments)
      .where(and(eq(comments.id, id), eq(comments.workspaceId, workspaceId)));
  }

  async listByTarget(
    tenant: TenantContext,
    query: TargetQuery,
  ): Promise<Comment[]> {
    const workspaceId = tenant.workspaceId;
    const conditions = [
      eq(comments.workspaceId, workspaceId),
      // `TargetQuery` carries `kind` + `id` only (no `recordType`), so match on
      // `context_id` — IDENTICAL to `InMemoryCommentStore.matchesTarget`, which
      // compares `kind` + `id` (+ optional `sectionKey`) and IGNORES the live
      // `contextType` (all live record contexts collapse to `kind:'record'` via
      // `targetFromLive`). The live `comments` table only stores record-kind
      // contexts, so `context_id` scoping is faithful.
      eq(comments.contextId, query.id),
    ];
    if (query.sectionKey !== undefined) {
      conditions.push(eq(comments.sectionKey, query.sectionKey));
    }
    if (query.status !== undefined) {
      conditions.push(eq(comments.status, query.status === 'resolved' ? 'closed' : 'open'));
    }
    const rows = await this.db
      .select()
      .from(comments)
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    return rows.map((row) => this.toComment(tenant, row));
  }

  async listThread(
    tenant: TenantContext,
    threadId: string,
  ): Promise<Comment[]> {
    const rows = await this.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.workspaceId, tenant.workspaceId),
          eq(comments.threadId, threadId),
        ),
      )
      .orderBy(asc(comments.createdAt), asc(comments.id));
    return rows.map((row) => this.toComment(tenant, row));
  }

  async listThreadSummaries(
    tenant: TenantContext,
    query: TargetQuery,
  ): Promise<CommentThreadSummary[]> {
    const conditions = [
      eq(comments.workspaceId, tenant.workspaceId),
      // Match on `context_id` only — parity with `InMemoryCommentStore`
      // (see `listByTarget`); `TargetQuery` carries no `recordType`.
      eq(comments.contextId, query.id),
    ];
    if (query.sectionKey !== undefined) {
      conditions.push(eq(comments.sectionKey, query.sectionKey));
    }
    const rows = await this.db
      .select()
      .from(comments)
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt), asc(comments.id));

    // Group-by threadId EXACTLY as tool-service.ts:1244-1269: root=earliest,
    // last=latest, count, status closed-if-any (-> 'resolved'), first non-null
    // assignee. Rows already ordered createdAt ASC, id ASC.
    const byThread = new Map<string, CommentRow[]>();
    for (const row of rows) {
      const bucket = byThread.get(row.threadId);
      if (bucket) {
        bucket.push(row);
      } else {
        byThread.set(row.threadId, [row]);
      }
    }

    const summaries: CommentThreadSummary[] = [];
    for (const [threadId, threadRows] of byThread) {
      const root = threadRows[0];
      const last = threadRows[threadRows.length - 1];
      const status: CommentState = threadRows.some((r) => r.status === 'closed')
        ? 'resolved'
        : 'open';
      const assignee = threadRows.find(
        (r) => r.assignedTo !== null && r.assignedTo !== undefined,
      )?.assignedTo;
      if (query.status !== undefined && status !== query.status) {
        continue;
      }
      const target = targetFromLive({
        contextType: root.contextType,
        contextId: root.contextId,
        sectionKey: root.sectionKey,
      });
      summaries.push({
        threadId,
        contextType: target.recordType,
        target,
        sectionKey: target.sectionKey,
        rootMessage: root.content,
        rootMessageAt: toIso(root.createdAt),
        lastMessage: last.content,
        lastMessageAt: toIso(last.createdAt),
        messageCount: threadRows.length,
        status,
        assignee: assignee ?? undefined,
      });
    }
    return summaries;
  }

  async setState(
    tenant: TenantContext,
    threadId: string,
    state: CommentState,
  ): Promise<Comment[]> {
    const workspaceId = tenant.workspaceId;
    const existing = await this.listThread(tenant, threadId);
    if (existing.length === 0) {
      throw new ThreadNotFoundError(threadId);
    }
    // THREAD CASCADE (mirrors comments.ts:278-281,307-310).
    await this.db
      .update(comments)
      .set({ status: state === 'resolved' ? 'closed' : 'open', updatedAt: new Date() })
      .where(
        and(
          eq(comments.workspaceId, workspaceId),
          eq(comments.threadId, threadId),
        ),
      );
    return this.listThread(tenant, threadId);
  }

  async assign(
    tenant: TenantContext,
    threadId: string,
    assigneeId: string | null,
  ): Promise<Comment[]> {
    const workspaceId = tenant.workspaceId;
    const existing = await this.listThread(tenant, threadId);
    if (existing.length === 0) {
      throw new ThreadNotFoundError(threadId);
    }
    // THREAD CASCADE (mirrors comments.ts:198-203,246-250). `null` -> unassign
    // (FK `set null`, schema.ts:657); the REST `assigned_to:null -> createdBy`
    // default is computed HOST-SIDE before calling assign() (SPEC §2 / v3 fix #2).
    await this.db
      .update(comments)
      .set({ assignedTo: assigneeId, updatedAt: new Date() })
      .where(
        and(
          eq(comments.workspaceId, workspaceId),
          eq(comments.threadId, threadId),
        ),
      );
    return this.listThread(tenant, threadId);
  }

  /**
   * THREAD-WIDE combined content + assignment edit in ONE atomic statement
   * (mirrors the OLD live combined-PATCH `UPDATE comments SET content=?,
   * assigned_to=?, updated_at=? WHERE workspace_id AND thread_id`,
   * `comments.ts@40a23a35^:246-250`). App-local adapter primitive (NOT a
   * package-port method): the REST PATCH combined case needs ONE statement so
   * content + assignment land atomically thread-wide — composing N per-row
   * `edit()` then a separate `assign()` is non-atomic and, with the re-read
   * pattern, can yield new 404/500 under concurrent deletes where the single
   * UPDATE would 200. Same WHERE shape + emit-free posture as `setState`/`assign`
   * (host owns the single `updated` emit, §2/§4); empty thread ->
   * `ThreadNotFoundError`. `assignedTo:null -> createdBy` is computed HOST-SIDE
   * before calling (the route passes the resolved assignee).
   */
  async editThread(
    tenant: TenantContext,
    threadId: string,
    patch: { content: string; assignedTo: string | null },
  ): Promise<Comment[]> {
    const workspaceId = tenant.workspaceId;
    const existing = await this.listThread(tenant, threadId);
    if (existing.length === 0) {
      throw new ThreadNotFoundError(threadId);
    }
    // ONE atomic THREAD CASCADE: content + assignment + updatedAt in a single
    // UPDATE (mirrors the OLD combined-PATCH single statement).
    await this.db
      .update(comments)
      .set({ content: patch.content, assignedTo: patch.assignedTo, updatedAt: new Date() })
      .where(
        and(
          eq(comments.workspaceId, workspaceId),
          eq(comments.threadId, threadId),
        ),
      );
    return this.listThread(tenant, threadId);
  }

  private async selectRow(
    workspaceId: string,
    id: string,
  ): Promise<CommentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  private async requireRow(workspaceId: string, id: string): Promise<CommentRow> {
    const row = await this.selectRow(workspaceId, id);
    if (!row) {
      throw new CommentNotFoundError(id);
    }
    return row;
  }

  /** Map a live `comments` row back to the package `Comment` shape. */
  private toComment(tenant: TenantContext, row: CommentRow): Comment {
    const target = targetFromLive({
      contextType: row.contextType,
      contextId: row.contextId,
      sectionKey: row.sectionKey,
    });
    const comment: Comment = {
      id: row.id,
      tenant: { ...tenant },
      target,
      threadId: row.threadId,
      author: { id: row.createdBy },
      state: row.status === 'closed' ? 'resolved' : 'open',
      body: row.content,
      createdAt: toIso(row.createdAt),
    };
    if (row.assignedTo !== null && row.assignedTo !== undefined) {
      comment.assignedTo = row.assignedTo;
    }
    if (row.updatedAt !== null && row.updatedAt !== undefined) {
      comment.updatedAt = toIso(row.updatedAt);
    }
    if (row.toolCallId !== null && row.toolCallId !== undefined) {
      comment.provenance = { toolCallId: row.toolCallId };
    }
    return comment;
  }
}

/** Live timestamps are `Date` (timestamp column); normalise to ISO 8601. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
