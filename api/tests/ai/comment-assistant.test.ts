import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../../src/app';
import { createTestId, getTestModel } from '../utils/test-helpers';
import { createAuthenticatedUser, createTestUser, authenticatedRequest, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import {
  chatSessions,
  comments,
  folders,
  jobQueue,
  initiatives,
  users,
  workspaces,
  workspaceMemberships
} from '../../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { chatService } from '../../src/services/chat-service';
import { toolService } from '../../src/services/tool-service';
import { createId } from '../../src/utils/id';

const mockCallLLM = vi.fn();
const mockCallLLMStream = vi.fn();

vi.mock('../../src/services/llm-runtime', async () => {
  return {
    callLLM: (args: any) => mockCallLLM(args),
    callLLMStream: (args: any) => mockCallLLMStream(args),
  };
});

describe('AI - comment_assistant tool exposure', () => {
  let user: any;
  let folderId = '';
  let initiativeId = '';

  beforeEach(async () => {
    await cleanupAuthData();
    mockCallLLM.mockReset();
    mockCallLLMStream.mockReset();

    mockCallLLM.mockResolvedValue({
      choices: [{ message: { content: 'Titre' } }],
    });

    mockCallLLMStream.mockImplementation((options: any) => {
      async function* stream() {
        void options;
        yield { type: 'content_delta', data: { delta: 'ok' } };
        yield { type: 'done', data: {} };
      }
      return stream();
    });

    user = await createAuthenticatedUser('editor');
    const folderResponse = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder for comment assistant',
    });
    expect(folderResponse.status).toBe(201);
    folderId = (await folderResponse.json()).id;

    const initiativeResponse = await authenticatedRequest(app, 'POST', '/api/v1/initiatives', user.sessionToken!, {
      name: `Test UC ${createTestId()}`,
      description: 'Test use case for comment assistant',
      folderId,
    });
    expect(initiativeResponse.status).toBe(201);
    initiativeId = (await initiativeResponse.json()).id;
  });

  afterEach(async () => {
    if (initiativeId) await db.delete(initiatives).where(eq(initiatives.id, initiativeId));
    if (folderId) await db.delete(folders).where(eq(folders.id, folderId));
    if (user?.workspaceId) {
      await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
      await db.delete(chatSessions).where(eq(chatSessions.workspaceId, user.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, user.workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, user.workspaceId));
    }
    await cleanupAuthData();
  });

  it('exposes comment_assistant tool by default when comment contexts exist', async () => {
    mockCallLLMStream.mockImplementation((options: any) => {
      async function* stream() {
        void options;
        yield { type: 'content_delta', data: { delta: 'ok' } };
        yield { type: 'done', data: {} };
      }
      return stream();
    });

    const created = await chatService.createUserMessageWithAssistantPlaceholder({
      userId: user.id,
      sessionId: null,
      content: 'Analyse les commentaires',
      model: getTestModel(),
      workspaceId: user.workspaceId,
      primaryContextType: 'initiative',
      primaryContextId: initiativeId,
      contexts: undefined,
      sessionTitle: null,
    });

    await chatService.runAssistantGeneration({
      userId: user.id,
      sessionId: created.sessionId,
      assistantMessageId: created.assistantMessageId,
      model: created.model,
      contexts: undefined,
      tools: undefined,
    });

    const toolsFromCalls =
      mockCallLLMStream.mock.calls.map((call) => call[0]?.tools).find(Array.isArray) ?? [];
    const toolNames = toolsFromCalls
      .map((t) => (t.type === 'function' ? t.function?.name : null))
      .filter(Boolean);

    expect(toolNames).toContain('comment_assistant');
  });
});

describe('AI - comment_assistant permissions', () => {
  const now = new Date();
  const contextId = `uc_${createId()}`;
  const threadId = createId();
  let workspaceId = '';
  let viewerUser: any;
  let commenterUser: any;
  let editorUser: any;
  let adminUser: any;

  beforeEach(async () => {
    await cleanupAuthData();
    workspaceId = createId();

    viewerUser = await createTestUser({ email: `viewer-${createTestId()}@example.com`, role: 'guest', withWorkspace: false });
    commenterUser = await createTestUser({ email: `commenter-${createTestId()}@example.com`, role: 'guest', withWorkspace: false });
    editorUser = await createTestUser({ email: `editor-${createTestId()}@example.com`, role: 'editor', withWorkspace: false });
    adminUser = await createTestUser({ email: `admin-${createTestId()}@example.com`, role: 'guest', withWorkspace: false });

    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: commenterUser.id,
      name: `Test Workspace ${createTestId()}`,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workspaceMemberships).values([
      { workspaceId, userId: viewerUser.id, role: 'viewer', createdAt: now },
      { workspaceId, userId: commenterUser.id, role: 'commenter', createdAt: now },
      { workspaceId, userId: editorUser.id, role: 'editor', createdAt: now },
      { workspaceId, userId: adminUser.id, role: 'admin', createdAt: now },
    ]);

    await db.insert(comments).values({
      id: createId(),
      workspaceId,
      contextType: 'initiative',
      contextId,
      sectionKey: 'description',
      createdBy: commenterUser.id,
      assignedTo: commenterUser.id,
      status: 'open',
      threadId,
      content: 'Root comment',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(async () => {
    await db.delete(comments).where(eq(comments.workspaceId, workspaceId));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(inArray(users.id, [viewerUser.id, commenterUser.id, editorUser.id, adminUser.id]));
    await cleanupAuthData();
  });

  it('enforces viewer/commenter/editor/admin permissions for comment_assistant actions', async () => {
    await expect(
      toolService.resolveCommentActions({
        workspaceId,
        userId: viewerUser.id,
        allowedContexts: [{ contextType: 'initiative', contextId }],
        actions: [{ thread_id: threadId, action: 'note', note: 'Note viewer' }],
        toolCallId: createId(),
      })
    ).rejects.toThrow('Workspace commenter role required');

    const commenterResult = await toolService.resolveCommentActions({
      workspaceId,
      userId: commenterUser.id,
      allowedContexts: [{ contextType: 'initiative', contextId }],
      actions: [{ thread_id: threadId, action: 'note', note: 'Note commenter' }],
      toolCallId: createId(),
    });
    expect(commenterResult.notes.length).toBe(1);

    const editorResult = await toolService.resolveCommentActions({
      workspaceId,
      userId: editorUser.id,
      allowedContexts: [{ contextType: 'initiative', contextId }],
      actions: [{ thread_id: threadId, action: 'note', note: 'Note editor' }],
      toolCallId: createId(),
    });
    expect(editorResult.notes.length).toBe(1);

    const adminResult = await toolService.resolveCommentActions({
      workspaceId,
      userId: adminUser.id,
      allowedContexts: [{ contextType: 'initiative', contextId }],
      actions: [{ thread_id: threadId, action: 'close' }],
      toolCallId: createId(),
    });
    expect(adminResult.applied.some((item) => item.action === 'close')).toBe(true);
  });
});

// --- BR-42d Lot 0 characterization: AI read (summaries) + write (resolveCommentActions) ---

describe('AI - comment_assistant Lot 0 characterization', () => {
  const now = new Date();
  const contextId = `uc_${createId()}`;
  let workspaceId = '';
  let creatorUser: any;
  let assigneeUser: any;

  beforeEach(async () => {
    await cleanupAuthData();
    workspaceId = createId();
    creatorUser = await createTestUser({ email: `creator-${createTestId()}@example.com`, role: 'editor', withWorkspace: false });
    assigneeUser = await createTestUser({ email: `assignee-${createTestId()}@example.com`, role: 'editor', withWorkspace: false });

    await db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: creatorUser.id,
      name: `Test Workspace ${createTestId()}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workspaceMemberships).values([
      { workspaceId, userId: creatorUser.id, role: 'admin', createdAt: now },
      { workspaceId, userId: assigneeUser.id, role: 'editor', createdAt: now },
    ]);
  });

  afterEach(async () => {
    await db.delete(comments).where(eq(comments.workspaceId, workspaceId));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(inArray(users.id, [creatorUser.id, assigneeUser.id]));
    await cleanupAuthData();
  });

  it('pins the live CommentThreadSummary field set and thread grouping (tool-service.ts:1244-1268)', async () => {
    const threadId = createId();
    const rootAt = new Date(now.getTime());
    const midAt = new Date(now.getTime() + 1000);
    const lastAt = new Date(now.getTime() + 2000);

    // Root (earliest): no assignee, open. Reply 1: assigned, closed. Reply 2 (latest): open.
    await db.insert(comments).values([
      {
        id: createId(),
        workspaceId,
        contextType: 'initiative',
        contextId,
        sectionKey: 'description',
        createdBy: creatorUser.id,
        assignedTo: null,
        status: 'open',
        threadId,
        content: 'Root message',
        createdAt: rootAt,
        updatedAt: rootAt,
      },
      {
        id: createId(),
        workspaceId,
        contextType: 'initiative',
        contextId,
        sectionKey: 'description',
        createdBy: creatorUser.id,
        assignedTo: assigneeUser.id,
        status: 'closed',
        threadId,
        content: 'Middle message',
        createdAt: midAt,
        updatedAt: midAt,
      },
      {
        id: createId(),
        workspaceId,
        contextType: 'initiative',
        contextId,
        sectionKey: 'description',
        createdBy: creatorUser.id,
        assignedTo: null,
        status: 'open',
        threadId,
        content: 'Last message',
        createdAt: lastAt,
        updatedAt: lastAt,
      },
    ]);

    const result = await toolService.listCommentThreadsForContexts({
      workspaceId,
      contexts: [{ contextType: 'initiative', contextId }],
    });

    expect(result.threads.length).toBe(1);
    const summary = result.threads[0];
    // Exact CommentThreadSummary key set (context-comments.ts:6-21)
    expect(Object.keys(summary).sort()).toEqual(
      [
        'assignedTo',
        'contextId',
        'contextType',
        'createdAt',
        'createdBy',
        'lastMessage',
        'lastMessageAt',
        'messageCount',
        'rootMessage',
        'rootMessageAt',
        'sectionKey',
        'status',
        'threadId',
        'updatedAt',
      ].sort()
    );
    expect(summary.threadId).toBe(threadId);
    expect(summary.contextType).toBe('initiative');
    expect(summary.contextId).toBe(contextId);
    expect(summary.sectionKey).toBe('description');
    expect(summary.createdBy).toBe(creatorUser.id);
    // root = earliest row content + its createdAt
    expect(summary.rootMessage).toBe('Root message');
    expect(summary.rootMessageAt).toBe(rootAt.toISOString());
    expect(summary.createdAt).toBe(rootAt.toISOString());
    // last = latest row processed (createdAt ASC -> last row)
    expect(summary.lastMessage).toBe('Last message');
    expect(summary.lastMessageAt).toBe(lastAt.toISOString());
    // count = number of rows in the thread
    expect(summary.messageCount).toBe(3);
    // status = closed if ANY row is closed (tool-service.ts:1267)
    expect(summary.status).toBe('closed');
    // assignedTo = FIRST non-null assignee encountered (tool-service.ts:1268)
    expect(summary.assignedTo).toBe(assigneeUser.id);
    // users label list includes both involved users
    const userIds = result.users.map((u) => u.id).sort();
    expect(userIds).toEqual([creatorUser.id, assigneeUser.id].sort());
    expect(Object.keys(result.users[0]).sort()).toEqual(['displayName', 'email', 'id']);
  });

  it('resolveCommentActions close + reassign + note apply, with note provenance toolCallId (tool-service.ts:1360-1412)', async () => {
    const threadId = createId();
    await db.insert(comments).values({
      id: createId(),
      workspaceId,
      contextType: 'initiative',
      contextId,
      sectionKey: 'description',
      createdBy: creatorUser.id,
      assignedTo: creatorUser.id,
      status: 'open',
      threadId,
      content: 'Root to resolve',
      createdAt: now,
      updatedAt: now,
    });

    const toolCallId = createId();
    const result = await toolService.resolveCommentActions({
      workspaceId,
      userId: creatorUser.id,
      allowedContexts: [{ contextType: 'initiative', contextId }],
      actions: [
        { thread_id: threadId, action: 'reassign', reassign_to: assigneeUser.id },
        { thread_id: threadId, action: 'note', note: 'Explicit trace note' },
        { thread_id: threadId, action: 'close' },
      ],
      toolCallId,
    });

    // applied carries close + reassign with their statuses
    expect(result.applied).toEqual(
      expect.arrayContaining([
        { thread_id: threadId, action: 'reassign', status: 'updated' },
        { thread_id: threadId, action: 'close', status: 'closed' },
      ])
    );
    // exactly one trace-note created for the thread
    expect(result.notes.length).toBe(1);
    expect(result.notes[0].thread_id).toBe(threadId);

    // thread cascade: every row closed + reassigned
    const rows = await db
      .select({ id: comments.id, status: comments.status, assignedTo: comments.assignedTo, content: comments.content, toolCallId: comments.toolCallId })
      .from(comments)
      .where(eq(comments.threadId, threadId));
    expect(rows.every((r) => r.status === 'closed')).toBe(true);
    expect(rows.every((r) => r.assignedTo === assigneeUser.id)).toBe(true);

    // the trace note row carries the explicit note + toolCallId provenance (tool-service.ts:1396-1410)
    const noteRow = rows.find((r) => r.id === result.notes[0].note_id);
    expect(noteRow).toBeTruthy();
    expect(noteRow!.content).toBe('Explicit trace note');
    expect(noteRow!.toolCallId).toBe(toolCallId);
  });
});
