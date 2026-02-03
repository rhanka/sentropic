import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import {
  createAuthenticatedUser,
  authenticatedRequest,
  cleanupAuthData
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { comments, organizations, folders, useCases, workspaceMemberships } from '../../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';

describe('Comments API', () => {
  let user: any;
  let editor: any;
  let admin: any;
  let organizationId: string;
  let folderId: string;
  let useCaseId: string;

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

    const useCaseRes = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, {
      name: `Test Use Case ${createTestId()}`,
      description: 'Use case for comments',
      folderId
    });
    expect(useCaseRes.status).toBe(201);
    useCaseId = (await useCaseRes.json()).id;
  });

  afterEach(async () => {
    if (user.workspaceId) {
      await db.delete(comments).where(eq(comments.workspaceId, user.workspaceId));
      await db.delete(useCases).where(eq(useCases.workspaceId, user.workspaceId));
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
      contextType: 'usecase',
      contextId: useCaseId,
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
      `/api/v1/comments?context_type=usecase&context_id=${useCaseId}`,
      user.sessionToken!
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items?.length).toBeGreaterThan(0);
    expect(body.items[0].tool_call_id).toBe('tool_abc');
  });

  it('rejects creation when assigned_to is not in workspace', async () => {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'usecase',
      context_id: useCaseId,
      content: 'Assign to invalid user',
      assigned_to: 'missing-user'
    });
    expect(res.status).toBe(400);
  });

  it('allows only creator or admin to close and reopen a thread', async () => {
    const createRes = await authenticatedRequest(app, 'POST', '/api/v1/comments', user.sessionToken!, {
      context_type: 'usecase',
      context_id: useCaseId,
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
});
