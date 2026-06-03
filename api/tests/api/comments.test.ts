import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import {
  createAuthenticatedUser,
  authenticatedRequest,
  cleanupAuthData
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { comments, organizations, folders, initiatives, workspaceMemberships } from '../../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';

describe('Comments API', () => {
  let user: any;
  let editor: any;
  let admin: any;
  let organizationId: string;
  let folderId: string;
  let initiativeId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor', `owner-${createTestId()}@example.com`);
    editor = await createAuthenticatedUser('editor', `editor-${createTestId()}@example.com`);
    admin = await createAuthenticatedUser('editor', `admin-${createTestId()}@example.com`);

    if (user.workspaceId) {
      await db
        .insert(workspaceMemberships)
        .values({ workspaceId: user.workspaceId, userId: editor.id, role: 'editor', createdAt: new Date() })
        .onConflictDoNothing();
      await db
        .insert(workspaceMemberships)
        .values({ workspaceId: user.workspaceId, userId: admin.id, role: 'admin', createdAt: new Date() })
        .onConflictDoNothing();
    }

    const orgRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Test Organization ${createTestId()}`,
      industry: 'Technology'
    });
    expect(orgRes.status).toBe(201);
    organizationId = (await orgRes.json()).id;

    const folderRes = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
      name: `Test Folder ${createTestId()}`,
      description: 'Folder for comments',
      organizationId
    });
    expect(folderRes.status).toBe(201);
    folderId = (await folderRes.json()).id;

    const initiativeRes = await authenticatedRequest(app, 'POST', '/api/v1/initiatives', user.sessionToken!, {
      name: `Test Use Case ${createTestId()}`,
      description: 'Use case for comments',
      folderId
    });
    expect(initiativeRes.status).toBe(201);
    initiativeId = (await initiativeRes.json()).id;
  });

  afterEach(async () => {
    if (user.workspaceId) {
      await db.delete(comments).where(eq(comments.workspaceId, user.workspaceId));
      await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
      await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
      await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
  });

  it('returns tool_call_id in list responses', async () => {
    const threadId = createId();
    const commentId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: commentId,
      workspaceId: user.workspaceId!,
      contextType: 'initiative',
      contextId: initiativeId,
      sectionKey: 'header',
      createdBy: user.id,
      assignedTo: user.id,
      status: 'open',
      threadId,
      content: 'Comment with tool call id',
      toolCallId: 'tool_abc',
      createdAt: now,
      updatedAt: now
    });

    const res = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/comments?context_type=initiative&context_id=${initiativeId}`,
      user.sessionToken!
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items?.length).toBeGreaterThan(0);
    expect(body.items[0].tool_call_id).toBe('tool_abc');
  });

  it('rejects creation when assigned_to is not in workspace', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Assign to invalid user',
      assigned_to: 'missing-user'
    });
    expect(res.status).toBe(400);
  });

  it('allows only creator or admin to close and reopen a thread', async () => {
    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Comment to close'
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const commentId = createBody.id;
    const threadId = createBody.thread_id;

    const editorClose = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/comments/${commentId}/close?workspace_id=${user.workspaceId}`,
      editor.sessionToken!
    );
    expect(editorClose.status).toBe(403);

    const adminClose = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/comments/${commentId}/close?workspace_id=${user.workspaceId}`,
      admin.sessionToken!
    );
    expect(adminClose.status).toBe(200);

    const closedRows = await db
      .select({ status: comments.status })
      .from(comments)
      .where(and(eq(comments.workspaceId, user.workspaceId!), eq(comments.threadId, threadId)));
    expect(closedRows.every((row) => row.status === 'closed')).toBe(true);

    const adminReopen = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/comments/${commentId}/reopen?workspace_id=${user.workspaceId}`,
      admin.sessionToken!
    );
    expect(adminReopen.status).toBe(200);

    const reopenedRows = await db
      .select({ status: comments.status })
      .from(comments)
      .where(and(eq(comments.workspaceId, user.workspaceId!), eq(comments.threadId, threadId)));
    expect(reopenedRows.every((row) => row.status === 'open')).toBe(true);
  });

  // --- BR-42d Lot 0 characterization (pins live REST behavior; 0-regression oracle) ---

  it('POST returns exact {id, thread_id} 201 shape and mints a thread id (comments.ts:173,206)', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root comment'
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // Exact response keys: only id + thread_id (comments.ts:206)
    expect(Object.keys(body).sort()).toEqual(['id', 'thread_id']);
    expect(typeof body.id).toBe('string');
    expect(typeof body.thread_id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.thread_id.length).toBeGreaterThan(0);
  });

  it('GET list returns the full per-item field shape incl. user-label join (comments.ts:119-135)', async () => {
    const threadId = createId();
    const commentId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: commentId,
      workspaceId: user.workspaceId!,
      contextType: 'initiative',
      contextId: initiativeId,
      sectionKey: 'header',
      createdBy: user.id,
      assignedTo: editor.id,
      status: 'open',
      threadId,
      content: 'Listed comment',
      toolCallId: null,
      createdAt: now,
      updatedAt: now
    });

    const res = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/comments?context_type=initiative&context_id=${initiativeId}`,
      user.sessionToken!
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Top-level response shape: only { items } (comments.ts:119)
    expect(Object.keys(body)).toEqual(['items']);
    const item = body.items.find((i: any) => i.id === commentId);
    expect(item).toBeTruthy();
    // Exact per-item key set (comments.ts:120-135)
    expect(Object.keys(item).sort()).toEqual(
      [
        'assigned_to',
        'assigned_to_user',
        'content',
        'context_id',
        'context_type',
        'created_at',
        'created_by',
        'created_by_user',
        'id',
        'section_key',
        'status',
        'thread_id',
        'tool_call_id',
        'updated_at'
      ].sort()
    );
    expect(item.context_type).toBe('initiative');
    expect(item.context_id).toBe(initiativeId);
    expect(item.section_key).toBe('header');
    expect(item.created_by).toBe(user.id);
    expect(item.assigned_to).toBe(editor.id);
    expect(item.status).toBe('open');
    expect(item.thread_id).toBe(threadId);
    expect(item.content).toBe('Listed comment');
    expect(item.tool_call_id).toBeNull();
    // user-label join shape (comments.ts:108-116,133-134)
    expect(item.created_by_user).toMatchObject({ id: user.id, email: user.email });
    expect(Object.keys(item.created_by_user).sort()).toEqual(['displayName', 'email', 'id']);
    expect(item.assigned_to_user).toMatchObject({ id: editor.id, email: editor.email });
  });

  it('GET list filters by status and section_key (comments.ts:93-94)', async () => {
    const now = new Date();
    const openId = createId();
    const closedId = createId();
    await db.insert(comments).values([
      {
        id: openId,
        workspaceId: user.workspaceId!,
        contextType: 'initiative',
        contextId: initiativeId,
        sectionKey: 'alpha',
        createdBy: user.id,
        assignedTo: user.id,
        status: 'open',
        threadId: createId(),
        content: 'open alpha',
        createdAt: now,
        updatedAt: now
      },
      {
        id: closedId,
        workspaceId: user.workspaceId!,
        contextType: 'initiative',
        contextId: initiativeId,
        sectionKey: 'beta',
        createdBy: user.id,
        assignedTo: user.id,
        status: 'closed',
        threadId: createId(),
        content: 'closed beta',
        createdAt: now,
        updatedAt: now
      }
    ]);

    const openRes = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/comments?context_type=initiative&context_id=${initiativeId}&status=open`,
      user.sessionToken!
    );
    const openBody = await openRes.json();
    expect(openBody.items.some((i: any) => i.id === openId)).toBe(true);
    expect(openBody.items.some((i: any) => i.id === closedId)).toBe(false);

    const sectionRes = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/comments?context_type=initiative&context_id=${initiativeId}&section_key=beta`,
      user.sessionToken!
    );
    const sectionBody = await sectionRes.json();
    expect(sectionBody.items.some((i: any) => i.id === closedId)).toBe(true);
    expect(sectionBody.items.some((i: any) => i.id === openId)).toBe(false);
  });

  it('POST root with no assigned_to defaults assignee to the creator (comments.ts:176)', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root default assignee'
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const [row] = await db
      .select({ assignedTo: comments.assignedTo, createdBy: comments.createdBy })
      .from(comments)
      .where(eq(comments.id, id));
    expect(row.createdBy).toBe(user.id);
    expect(row.assignedTo).toBe(user.id);
  });

  it('POST reply with no assigned_to inherits the existing thread assignee (comments.ts:176 existingThreadAssignee)', async () => {
    // Root explicitly assigned to editor -> thread assignee = editor
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root assigned to editor',
      assigned_to: editor.id
    });
    expect(rootRes.status).toBe(201);
    const { thread_id } = await rootRes.json();

    // Reply WITHOUT assigned_to -> inherits existing thread assignee (editor), NOT the creator
    const replyRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Reply inherits assignee',
      thread_id
    });
    expect(replyRes.status).toBe(201);
    const { id: replyId } = await replyRes.json();
    const [replyRow] = await db
      .select({ assignedTo: comments.assignedTo, createdBy: comments.createdBy })
      .from(comments)
      .where(eq(comments.id, replyId));
    expect(replyRow.createdBy).toBe(user.id);
    expect(replyRow.assignedTo).toBe(editor.id);
  });

  it('POST reply to a non-existent thread returns 404 "Thread not found" (comments.ts:170)', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Reply to ghost thread',
      thread_id: createId()
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Thread not found');
  });

  it('POST with an assignee cascades the assignee thread-wide (comments.ts:198-203)', async () => {
    // Root assigned to user (creator)
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root for cascade'
    });
    const { id: rootId, thread_id } = await rootRes.json();

    // Reply that explicitly assigns to editor -> cascades to the WHOLE thread (root included)
    const replyRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Reply assigns whole thread',
      thread_id,
      assigned_to: editor.id
    });
    expect(replyRes.status).toBe(201);

    const rows = await db
      .select({ id: comments.id, assignedTo: comments.assignedTo })
      .from(comments)
      .where(and(eq(comments.workspaceId, user.workspaceId!), eq(comments.threadId, thread_id)));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.assignedTo === editor.id)).toBe(true);
    expect(rows.some((r) => r.id === rootId)).toBe(true);
  });

  it('PATCH content edits only the targeted row (comments.ts:252)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Original root'
    });
    const { id: rootId, thread_id } = await rootRes.json();
    const replyRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Original reply',
      thread_id
    });
    const { id: replyId } = await replyRes.json();

    const patchRes = await authenticatedRequest(app, 'PATCH', `/api/v1/comments/${rootId}`, user.sessionToken!, {
      content: 'Edited root'
    });
    expect(patchRes.status).toBe(200);
    expect(await patchRes.json()).toEqual({ success: true });

    const [rootRow] = await db.select({ content: comments.content }).from(comments).where(eq(comments.id, rootId));
    const [replyRow] = await db.select({ content: comments.content }).from(comments).where(eq(comments.id, replyId));
    expect(rootRow.content).toBe('Edited root');
    expect(replyRow.content).toBe('Original reply');
  });

  it('PATCH with assignment cascades the WHOLE updates (content + assignment) thread-wide (comments.ts:235-254)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root before combined patch'
    });
    const { id: rootId, thread_id } = await rootRes.json();
    const replyRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Reply before combined patch',
      thread_id
    });
    const { id: replyId } = await replyRes.json();

    // Combined PATCH (content + assigned_to) on the root: cascades BOTH fields thread-wide
    const patchRes = await authenticatedRequest(app, 'PATCH', `/api/v1/comments/${rootId}`, user.sessionToken!, {
      content: 'Cascaded content',
      assigned_to: editor.id
    });
    expect(patchRes.status).toBe(200);

    const rows = await db
      .select({ id: comments.id, content: comments.content, assignedTo: comments.assignedTo })
      .from(comments)
      .where(and(eq(comments.workspaceId, user.workspaceId!), eq(comments.threadId, thread_id)));
    expect(rows.length).toBe(2);
    // Whole-updates cascade: content AND assignee applied to every row in the thread
    expect(rows.every((r) => r.assignedTo === editor.id)).toBe(true);
    expect(rows.every((r) => r.content === 'Cascaded content')).toBe(true);
    expect(rows.some((r) => r.id === replyId)).toBe(true);
  });

  it('PATCH assigned_to:null falls back to row.createdBy, NOT unassign, and cascades (comments.ts:238)', async () => {
    // Root assigned to editor at creation
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root assigned editor',
      assigned_to: editor.id
    });
    const { id: rootId, thread_id } = await rootRes.json();

    // PATCH assigned_to: null -> resolves to row.createdBy (user), not null
    const patchRes = await authenticatedRequest(app, 'PATCH', `/api/v1/comments/${rootId}`, user.sessionToken!, {
      assigned_to: null
    });
    expect(patchRes.status).toBe(200);

    const rows = await db
      .select({ assignedTo: comments.assignedTo })
      .from(comments)
      .where(and(eq(comments.workspaceId, user.workspaceId!), eq(comments.threadId, thread_id)));
    expect(rows.every((r) => r.assignedTo === user.id)).toBe(true);
    expect(rows.every((r) => r.assignedTo !== null)).toBe(true);
  });

  it('PATCH with no updatable fields returns 400 "No updates" (comments.ts:244)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root no-op patch'
    });
    const { id: rootId } = await rootRes.json();
    const patchRes = await authenticatedRequest(app, 'PATCH', `/api/v1/comments/${rootId}`, user.sessionToken!, {});
    expect(patchRes.status).toBe(400);
    expect((await patchRes.json()).message).toBe('No updates');
  });

  it('PATCH assignee-not-member returns 400 (comments.ts:239-240)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root for bad assignee patch'
    });
    const { id: rootId } = await rootRes.json();
    const patchRes = await authenticatedRequest(app, 'PATCH', `/api/v1/comments/${rootId}`, user.sessionToken!, {
      assigned_to: 'not-a-member'
    });
    expect(patchRes.status).toBe(400);
    expect((await patchRes.json()).message).toBe('Assigned user not in workspace');
  });

  it('PATCH by a non-creator non-admin is forbidden 403 (comments.ts:231)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root owned by user'
    });
    const { id: rootId } = await rootRes.json();
    // ?workspace_id pins the editor's session to the target workspace (auth.ts:80-90);
    // without it the editor resolves to their own workspace and the row 404s instead.
    const patchRes = await authenticatedRequest(
      app,
      'PATCH',
      `/api/v1/comments/${rootId}?workspace_id=${user.workspaceId}`,
      editor.sessionToken!,
      { content: 'Editor tries to edit' }
    );
    expect(patchRes.status).toBe(403);
    expect((await patchRes.json()).message).toBe('Insufficient permissions');
  });

  it('DELETE hard-deletes only the targeted row; replies survive (comments.ts:336)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root to delete'
    });
    const { id: rootId, thread_id } = await rootRes.json();
    const replyRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Reply that survives',
      thread_id
    });
    const { id: replyId } = await replyRes.json();

    const delRes = await authenticatedRequest(app, 'DELETE', `/api/v1/comments/${rootId}`, user.sessionToken!);
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ success: true });

    const remaining = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.workspaceId, user.workspaceId!), eq(comments.threadId, thread_id)));
    expect(remaining.map((r) => r.id)).toEqual([replyId]);
  });

  it('DELETE by a non-creator non-admin is forbidden 403 (comments.ts:332)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root for delete gate'
    });
    const { id: rootId } = await rootRes.json();
    // ?workspace_id pins the editor's session to the target workspace (auth.ts:80-90);
    // without it the editor resolves to their own workspace and the row 404s instead.
    const delRes = await authenticatedRequest(
      app,
      'DELETE',
      `/api/v1/comments/${rootId}?workspace_id=${user.workspaceId}`,
      editor.sessionToken!
    );
    expect(delRes.status).toBe(403);
    expect((await delRes.json()).message).toBe('Insufficient permissions');
  });

  it('close then reopen cascade returns {success:true} (comments.ts:284,313)', async () => {
    const rootRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'initiative',
      context_id: initiativeId,
      content: 'Root close-reopen shape'
    });
    const { id: rootId, thread_id } = await rootRes.json();

    const closeRes = await authenticatedRequest(app, 'POST', `/api/v1/comments/${rootId}/close`, user.sessionToken!);
    expect(closeRes.status).toBe(200);
    expect(await closeRes.json()).toEqual({ success: true });
    const closedRows = await db
      .select({ status: comments.status })
      .from(comments)
      .where(and(eq(comments.workspaceId, user.workspaceId!), eq(comments.threadId, thread_id)));
    expect(closedRows.every((r) => r.status === 'closed')).toBe(true);

    const reopenRes = await authenticatedRequest(app, 'POST', `/api/v1/comments/${rootId}/reopen`, user.sessionToken!);
    expect(reopenRes.status).toBe(200);
    expect(await reopenRes.json()).toEqual({ success: true });
  });
});
