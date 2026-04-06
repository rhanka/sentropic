import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import {
  chatMessages,
  chatSessions,
  chatStreamEvents,
  folders,
  jobQueue,
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

// Mock freeform docx generation
vi.mock('../../src/services/docx-generation', () => {
  return {
    generateFreeformDocx: vi.fn(),
  };
});

// Mock S3 storage
vi.mock('../../src/services/storage-s3', () => {
  return {
    putObject: vi.fn().mockResolvedValue(undefined),
    getDocumentsBucketName: vi.fn().mockReturnValue('test-bucket'),
  };
});

import { callLLMStream } from '../../src/services/llm-runtime';
import { generateFreeformDocx } from '../../src/services/docx-generation';
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
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, workspaceId));
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

  it('should return upskill content when action is "upskill"', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_upskill_1',
            name: 'document_generate',
            args: JSON.stringify({
              action: 'upskill',
              entityType: 'initiative',
              entityId: 'init-up-1',
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
        content: 'teach me docx generation',
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

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const resultEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_upskill_1',
    );
    expect(resultEvent).toBeDefined();
    const resultData = resultEvent!.data as any;
    expect(resultData.result.status).toBe('completed');
    expect(resultData.result.mode).toBe('upskill');
    expect(typeof resultData.result.skill).toBe('string');
    expect(resultData.result.skill.length).toBeGreaterThan(0);
  });

  it('should produce jobId, fileName, downloadUrl for freeform code generation', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    const freeformMock = generateFreeformDocx as unknown as ReturnType<typeof vi.fn>;

    freeformMock.mockResolvedValueOnce({
      buffer: Buffer.from('fake-docx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'freeform-output.docx',
    });

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_freeform_1',
            name: 'document_generate',
            args: JSON.stringify({
              action: 'generate',
              code: 'return doc([p("Hello")])',
              entityType: 'initiative',
              entityId: 'init-code-1',
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
        content: 'generate a custom docx',
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

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const resultEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_freeform_1',
    );
    expect(resultEvent).toBeDefined();
    const resultData = resultEvent!.data as any;
    expect(resultData.result.status).toBe('completed');
    expect(resultData.result.mode).toBe('freeform');
    expect(typeof resultData.result.jobId).toBe('string');
    expect(resultData.result.jobId.length).toBeGreaterThan(0);
    expect(typeof resultData.result.fileName).toBe('string');
    expect(resultData.result.downloadUrl).toContain('/docx/jobs/');
  });

  it('should reject when both templateId and code are provided', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_mutual_excl',
            name: 'document_generate',
            args: JSON.stringify({
              templateId: 'usecase-onepage',
              code: 'return doc([p("Hello")])',
              entityType: 'initiative',
              entityId: 'init-both-1',
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
        content: 'generate with both params',
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

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const errorEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_mutual_excl' &&
        (e.data as any)?.result?.status === 'error',
    );
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.data as any).result.error).toContain('mutually exclusive');
  });

  it('should reject when neither templateId nor code is provided', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_neither',
            name: 'document_generate',
            args: JSON.stringify({
              entityType: 'initiative',
              entityId: 'init-none-1',
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
        content: 'generate with nothing',
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

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const errorEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_neither' &&
        (e.data as any)?.result?.status === 'error',
    );
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.data as any).result.error).toContain('either templateId or code');
  });

  it('should map freeform error codes: syntax error', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    const freeformMock = generateFreeformDocx as unknown as ReturnType<typeof vi.fn>;

    freeformMock.mockRejectedValueOnce(new Error('SyntaxError: Unexpected token'));

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_err_syntax',
            name: 'document_generate',
            args: JSON.stringify({
              code: 'return doc([p("broken',
              entityType: 'initiative',
              entityId: 'init-err-1',
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
        content: 'generate with bad code',
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

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const errorEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_err_syntax',
    );
    expect(errorEvent).toBeDefined();
    const resultData = (errorEvent!.data as any).result;
    expect(resultData.status).toBe('error');
    expect(resultData.code).toBe('code_syntax_error');
  });

  it('should map freeform error codes: timeout', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    const freeformMock = generateFreeformDocx as unknown as ReturnType<typeof vi.fn>;

    freeformMock.mockRejectedValueOnce(new Error('Script execution timeout exceeded'));

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_err_timeout',
            name: 'document_generate',
            args: JSON.stringify({
              code: 'while(true){}',
              entityType: 'initiative',
              entityId: 'init-err-2',
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
        content: 'generate with infinite loop',
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

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const errorEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_err_timeout',
    );
    expect(errorEvent).toBeDefined();
    const resultData = (errorEvent!.data as any).result;
    expect(resultData.status).toBe('error');
    expect(resultData.code).toBe('code_timeout');
  });

  it('should map freeform error codes: runtime error (default)', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    const freeformMock = generateFreeformDocx as unknown as ReturnType<typeof vi.fn>;

    freeformMock.mockRejectedValueOnce(new Error('Cannot read property x of undefined'));

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_err_runtime',
            name: 'document_generate',
            args: JSON.stringify({
              code: 'return doc([unknownVar])',
              entityType: 'initiative',
              entityId: 'init-err-3',
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
        content: 'generate with runtime error',
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

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, assistantMessageId));

    const errorEvent = events.find(
      (e: any) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'tool_err_runtime',
    );
    expect(errorEvent).toBeDefined();
    const resultData = (errorEvent!.data as any).result;
    expect(resultData.status).toBe('error');
    expect(resultData.code).toBe('code_runtime_error');
  });
});
