import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import {
  chatMessages,
  chatSessions,
  chatStreamEvents,
  folders,
  users,
  workspaces,
  workspaceMemberships,
} from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';

// Mock OpenAI streaming — must be declared before importing chatService.
vi.mock('../../src/services/llm-runtime', () => {
  return {
    callLLMStream: vi.fn(),
  };
});

import { callLLMStream } from '../../src/services/llm-runtime';
import { chatService } from '../../src/services/chat-service';

type StreamEvent = { type: string; data: unknown };

async function* stream(events: StreamEvent[]): AsyncGenerator<StreamEvent, void, unknown> {
  for (const e of events) yield e;
}

function toolNames(tools: any[] | undefined): string[] {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => (t && typeof t === 'object' ? (t as any).function?.name : undefined))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

describe('ChatService - document_generate tool (unit, mocked OpenAI)', () => {
  let userId: string;
  let workspaceId: string;
  let folderId: string;

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `docgen-test-${userId}@example.com`,
      displayName: 'DocGen Test User',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    ({ workspaceId } = await ensureWorkspaceForUser(userId));

    // Default workspace from ensureWorkspaceForUser is neutral; set to ai-ideas for tests
    await db.update(workspaces).set({ type: 'ai-ideas' }).where(eq(workspaces.id, workspaceId));

    folderId = createId();
    await db.insert(folders).values({
      id: folderId,
      workspaceId,
      name: 'Folder for document_generate tests',
      description: 'Desc',
      matrixConfig: JSON.stringify({ valueAxes: [], complexityAxes: [] }),
      executiveSummary: JSON.stringify({ introduction: '' }),
      status: 'completed',
      createdAt: new Date(),
    });
  });

  afterEach(async () => {
    await db.delete(chatStreamEvents);
    await db.delete(chatMessages);
    await db.delete(chatSessions).where(eq(chatSessions.userId, userId));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
    vi.clearAllMocks();
  });

  it('should include document_generate in tool list for ai-ideas workspace', async () => {
    // Default workspace type is ai-ideas
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    let capturedTools: string[] = [];

    mock.mockImplementation((opts: any) => {
      capturedTools = toolNames(opts?.tools);
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]);
    });

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'generate a document',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
    });

    expect(capturedTools).toContain('document_generate');
  });

  it('should include document_generate in tool list for opportunity workspace', async () => {
    // Update workspace type to opportunity
    await db.update(workspaces).set({ type: 'opportunity' }).where(eq(workspaces.id, workspaceId));

    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    let capturedTools: string[] = [];

    mock.mockImplementation((opts: any) => {
      capturedTools = toolNames(opts?.tools);
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]);
    });

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'generate a document',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
    });

    expect(capturedTools).toContain('document_generate');
  });

  it('should NOT include document_generate for neutral workspace', async () => {
    await db.update(workspaces).set({ type: 'neutral' }).where(eq(workspaces.id, workspaceId));

    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    let capturedTools: string[] = [];

    mock.mockImplementation((opts: any) => {
      capturedTools = toolNames(opts?.tools);
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]);
    });

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'generate a document',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
    });

    expect(capturedTools).not.toContain('document_generate');
  });

  it('should handle document_generate tool call and produce a result event', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_docgen_1',
            name: 'document_generate',
            args: JSON.stringify({
              templateId: 'usecase-onepage',
              entityType: 'initiative',
              entityId: 'init-123',
            }),
          },
        },
        { type: 'done', data: {} },
      ]),
    );

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'generate a document for this initiative',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
    });

    // Read stream events and verify tool_call_result
    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const resultEvent = events.find(
      (e: any) => e.eventType === 'tool_call_result' && (e.data as any)?.tool_call_id === 'tool_docgen_1',
    );
    expect(resultEvent).toBeDefined();
    const resultData = resultEvent!.data as any;
    expect(resultData.result.status).toBe('completed');
    expect(resultData.result.templateId).toBe('usecase-onepage');
    expect(resultData.result.entityType).toBe('initiative');
    expect(resultData.result.entityId).toBe('init-123');
  });

  it('should reject document_generate when entityId is missing', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_docgen_noentity',
            name: 'document_generate',
            args: JSON.stringify({
              templateId: 'usecase-onepage',
              entityType: 'initiative',
              // entityId deliberately omitted
            }),
          },
        },
        { type: 'done', data: {} },
      ]),
    );

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'generate a doc',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
    });

    // Should produce an error result event since entityId is required
    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const errorEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_docgen_noentity' &&
        (e.data as any)?.result?.status === 'error',
    );
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.data as any).result.error).toContain('entityId');
  });
});
