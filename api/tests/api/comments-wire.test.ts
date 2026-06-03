import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { createAuthenticatedUser, authenticatedRequest, cleanupAuthData } from '../utils/auth-helper';
import { db, pool } from '../../src/db/client';
import { comments, organizations, folders, initiatives, workspaceMemberships } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { toolService } from '../../src/services/tool-service';

/**
 * BR-42d Lot 0 — wire-payload characterization.
 *
 * Pins the FULL per-(origin,event) `NOTIFY comment_events` wire-key matrix byte-for-byte.
 * All comment NOTIFY emissions (REST `comments.ts`, AI `tool-service.ts`, auto path) go
 * through the SAME `pool` singleton from `db/client`, so a single spy on `pool.connect`
 * captures every emission while still delegating to the real client (the NOTIFY actually
 * executes and the awaited round-trip back-pressure is preserved).
 */

type CommentNotify = { action?: string; comment_id?: string; thread_id?: string; [k: string]: unknown };

/** Parse a `NOTIFY comment_events, '<json>'` statement back into the emitted data object. */
function parseCommentNotify(sql: string): CommentNotify | null {
  const m = sql.match(/^NOTIFY comment_events, '([\s\S]*)'$/);
  if (!m) return null;
  // Reverse the live escaping: '' -> ' (escapeNotifyPayload / inline .replace(/'/g, "''"))
  const json = m[1].replace(/''/g, "'");
  try {
    const payload = JSON.parse(json) as { data?: CommentNotify };
    return payload.data ?? null;
  } catch {
    return null;
  }
}

describe('Comments wire-payload characterization (BR-42d Lot 0)', () => {
  let user: any;
  let editor: any;
  let initiativeId: string;
  let captured: CommentNotify[];
  let connectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    captured = [];
    // Wrap pool.connect so the returned client records every comment_events NOTIFY.
    // The pool reuses pooled clients across connect() calls, so a client's query must be
    // wrapped exactly once (a per-client flag prevents stacked interceptors double-counting).
    const realConnect = pool.connect.bind(pool);
    const WRAPPED = Symbol.for('comments-wire-test-wrapped');
    connectSpy = vi.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
      const client: any = await (realConnect as any)(...args);
      if (!client[WRAPPED]) {
        const realQuery = client.query.bind(client);
        client.query = (...qargs: any[]) => {
          const sql = typeof qargs[0] === 'string' ? qargs[0] : qargs[0]?.text;
          if (typeof sql === 'string' && sql.startsWith('NOTIFY comment_events')) {
            const data = parseCommentNotify(sql);
            if (data) captured.push(data);
          }
          return realQuery(...qargs);
        };
        client[WRAPPED] = true;
      }
      return client;
    });

    user = await createAuthenticatedUser('editor', `wire-owner-${createTestId()}@example.com`);
    editor = await createAuthenticatedUser('editor', `wire-editor-${createTestId()}@example.com`);
    if (user.workspaceId) {
      await db
        .insert(workspaceMemberships)
        .values({ workspaceId: user.workspaceId, userId: editor.id, role: 'editor', createdAt: new Date() })
        .onConflictDoNothing();
    }

    const orgRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Wire Org ${createTestId()}`,
      industry: 'Technology',
    });
    expect(orgRes.status).toBe(201);
    const organizationId = (await orgRes.json()).id;

    const folderRes = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
      name: `Wire Folder ${createTestId()}`,
      description: 'Folder for wire test',
      organizationId,
    });
    expect(folderRes.status).toBe(201);
    const folderId = (await folderRes.json()).id;

    const initiativeRes = await authenticatedRequest(app, 'POST', '/api/v1/initiatives', user.sessionToken!, {
      name: `Wire UC ${createTestId()}`,
      description: 'Use case for wire test',
      folderId,
    });
    expect(initiativeRes.status).toBe(201);
    initiativeId = (await initiativeRes.json()).id;

    // Clear setup-phase noise; tests assert only on their own emissions.
    captured = [];
  });

  afterEach(async () => {
    connectSpy.mockRestore();
    if (user.workspaceId) {
      await db.delete(comments).where(eq(comments.workspaceId, user.workspaceId));
      await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
      await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
      await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
  });

  // --- REST origin: every event keyed by comment_id (comments.ts:205,254,283,312,337) ---

  it('REST POST with NO assignee emits EXACTLY ONE {created, comment_id} (comments.ts:205)', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Wire root no-assignee',
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(captured).toEqual([{ action: 'created', comment_id: id }]);
  });

  it('REST POST WITH assignee still emits EXACTLY ONE {created, comment_id} despite the cascade (comments.ts:198-205)', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Wire root with assignee',
      assigned_to: editor.id,
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    // The thread-wide assignee cascade UPDATE does NOT emit a second event.
    expect(captured).toEqual([{ action: 'created', comment_id: id }]);
  });

  it('REST PATCH with assignment emits EXACTLY ONE {updated, comment_id} (comments.ts:254)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Wire root before patch',
    });
    const { id: rootId } = await rootRes.json();
    captured = [];

    const patchRes = await authenticatedRequest(app, 'PATCH', `/api/v1/comments/${rootId}`, user.sessionToken!, {
      content: 'patched',
      assigned_to: editor.id,
    });
    expect(patchRes.status).toBe(200);
    expect(captured).toEqual([{ action: 'updated', comment_id: rootId }]);
  });

  it('REST close emits {closed, comment_id} and reopen emits {reopened, comment_id} (comments.ts:283,312)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Wire root close/reopen',
    });
    const { id: rootId } = await rootRes.json();
    captured = [];

    const closeRes = await authenticatedRequest(app, 'POST', `/api/v1/comments/${rootId}/close`, user.sessionToken!);
    expect(closeRes.status).toBe(200);
    expect(captured).toEqual([{ action: 'closed', comment_id: rootId }]);
    captured = [];

    const reopenRes = await authenticatedRequest(app, 'POST', `/api/v1/comments/${rootId}/reopen`, user.sessionToken!);
    expect(reopenRes.status).toBe(200);
    expect(captured).toEqual([{ action: 'reopened', comment_id: rootId }]);
  });

  it('REST delete emits {deleted, comment_id} (comments.ts:337)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Wire root delete',
    });
    const { id: rootId } = await rootRes.json();
    captured = [];

    const delRes = await authenticatedRequest(app, 'DELETE', `/api/v1/comments/${rootId}`, user.sessionToken!);
    expect(delRes.status).toBe(200);
    expect(captured).toEqual([{ action: 'deleted', comment_id: rootId }]);
  });

  it('the awaited NOTIFY has flushed by the time the REST response resolves', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Wire awaited-notify',
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    // No post-response tick needed: the NOTIFY is awaited inside the handler before it returns.
    expect(captured).toContainEqual({ action: 'created', comment_id: id });
  });

  // --- AI origin: close/reassign keyed by thread_id, trace-note keyed by comment_id ---

  it('AI close emits {closed, thread_id}; reassign emits {reassigned, thread_id}; trace-note emits {created, comment_id} (tool-service.ts:1364,1381,1411)', async () => {
    const threadId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: createId(),
      workspaceId: user.workspaceId!,
      contextType: 'initiative',
      contextId: initiativeId,
      sectionKey: 'description',
      createdBy: user.id,
      assignedTo: user.id,
      status: 'open',
      threadId,
      content: 'AI wire root',
      createdAt: now,
      updatedAt: now,
    });
    captured = [];

    const toolCallId = createId();
    const result = await toolService.resolveCommentActions({
      workspaceId: user.workspaceId!,
      userId: user.id,
      allowedContexts: [{ contextType: 'initiative', contextId: initiativeId }],
      actions: [
        { thread_id: threadId, action: 'reassign', reassign_to: editor.id },
        { thread_id: threadId, action: 'close' },
        { thread_id: threadId, action: 'note', note: 'AI trace note' },
      ],
      toolCallId,
    });

    const noteId = result.notes[0]?.note_id;
    expect(noteId).toBeTruthy();
    // reassign -> thread_id key; close -> thread_id key; trace-note created -> comment_id key
    expect(captured).toEqual([
      { action: 'reassigned', thread_id: threadId },
      { action: 'closed', thread_id: threadId },
      { action: 'created', comment_id: noteId },
    ]);
  });

  // --- auto origin: created keyed by comment_id (tool-service.ts:1602) ---

  it('auto field-comment seeding emits {created, comment_id} per inserted comment (tool-service.ts:1602)', async () => {
    captured = [];
    // Drive the live private auto path that seeds field comments (M-AUTO).
    await (toolService as any).createAutoFieldComments({
      workspaceId: user.workspaceId!,
      contextType: 'initiative',
      contextId: initiativeId,
      sectionKeys: ['problem'],
      createdBy: user.id,
      assignedTo: user.id,
      toolCallId: null,
      locale: 'en',
    });

    const rows = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.workspaceId, user.workspaceId!));
    expect(rows.length).toBe(1);
    expect(captured).toEqual([{ action: 'created', comment_id: rows[0].id }]);
  });
});
