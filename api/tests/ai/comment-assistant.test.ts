import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../../src/app';
import { createTestId, getTestModel } from '../utils/test-helpers';
import { createAuthenticatedUser, authenticatedRequest, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import {
  chatSessions,
  folders,
  jobQueue,
  useCases,
  workspaces,
  workspaceMemberships
} from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { chatService } from '../../src/services/chat-service';

const mockCallOpenAI = vi.fn();
const mockCallOpenAIResponseStream = vi.fn();

vi.mock('../../src/services/openai', async () => {
  return {
    callOpenAI: (args: any) => mockCallOpenAI(args),
    callOpenAIResponseStream: (args: any) => mockCallOpenAIResponseStream(args),
  };
});

describe('AI - comment_assistant', () => {
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
