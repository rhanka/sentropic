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
  useCases,
  users,
  workspaces,
  workspaceMemberships
} from '../../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { chatService } from '../../src/services/chat-service';
import { toolService } from '../../src/services/tool-service';
import { createId } from '../../src/utils/id';

const mockCallOpenAI = vi.fn();
const mockCallOpenAIResponseStream = vi.fn();

vi.mock('../../src/services/openai', async () => {
  return {
    callOpenAI: (args: any) => mockCallOpenAI(args),
    callOpenAIResponseStream: (args: any) => mockCallOpenAIResponseStream(args),
  };
});

describe('AI - comment_assistant tool exposure', () => {
  let user: any;
  let folderId = '';
  let useCaseId = '';

  beforeEach(async () => {
    await cleanupAuthData();
    mockCallOpenAI.mockReset();
    mockCallOpenAIResponseStream.mockReset();

    mockCallOpenAI.mockResolvedValue({
      choices: [{ message: { content: 'Titre' } }],
    });

    mockCallOpenAIResponseStream.mockImplementation((options: any) => {
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

    const useCaseResponse = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, {
      name: `Test UC ${createTestId()}`,
      description: 'Test use case for comment assistant',
      folderId,
    });
    expect(useCaseResponse.status).toBe(201);
    useCaseId = (await useCaseResponse.json()).id;
  });

  afterEach(async () => {
    if (useCaseId) await db.delete(useCases).where(eq(useCases.id, useCaseId));
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
    mockCallOpenAIResponseStream.mockImplementation((options: any) => {
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
      primaryContextType: 'usecase',
      primaryContextId: useCaseId,
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
      mockCallOpenAIResponseStream.mock.calls.map((call) => call[0]?.tools).find(Array.isArray) ?? [];
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
      contextType: 'usecase',
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
        allowedContexts: [{ contextType: 'usecase', contextId }],
        actions: [{ thread_id: threadId, action: 'note', note: 'Note viewer' }],
        toolCallId: createId(),
      })
    ).rejects.toThrow('Workspace commenter role required');

    const commenterResult = await toolService.resolveCommentActions({
      workspaceId,
      userId: commenterUser.id,
      allowedContexts: [{ contextType: 'usecase', contextId }],
      actions: [{ thread_id: threadId, action: 'note', note: 'Note commenter' }],
      toolCallId: createId(),
    });
    expect(commenterResult.notes.length).toBe(1);

    const editorResult = await toolService.resolveCommentActions({
      workspaceId,
      userId: editorUser.id,
      allowedContexts: [{ contextType: 'usecase', contextId }],
      actions: [{ thread_id: threadId, action: 'note', note: 'Note editor' }],
      toolCallId: createId(),
    });
    expect(editorResult.notes.length).toBe(1);

    const adminResult = await toolService.resolveCommentActions({
      workspaceId,
      userId: adminUser.id,
      allowedContexts: [{ contextType: 'usecase', contextId }],
      actions: [{ thread_id: threadId, action: 'close' }],
      toolCallId: createId(),
    });
    expect(adminResult.applied.some((item) => item.action === 'close')).toBe(true);
  });
});
