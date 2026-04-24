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

// Mock freeform generators
vi.mock('../../src/services/docx-generation', () => {
  return {
    generateFreeformDocx: vi.fn(),
  };
});

vi.mock('../../src/services/pptx-generation', () => {
  return {
    generateFreeformPptx: vi.fn(),
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
import { generateFreeformPptx } from '../../src/services/pptx-generation';
import { putObject } from '../../src/services/storage-s3';
import { chatService } from '../../src/services/chat-service';

type StreamEvent = { type: string; data: unknown };

async function* stream(events: StreamEvent[]): AsyncGenerator<StreamEvent, void, unknown> {
  for (const e of events) yield e;
}

describe('ChatService - document_generate tool (PPTX freeform)', () => {
  let userId: string;
  let workspaceId: string;
  let folderId: string;

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `docgen-pptx-test-${userId}@example.com`,
      displayName: 'DocGen PPTX Test User',
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
      name: 'Folder for document_generate PPTX tests',
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

  it('returns PPTX upskill content when format is "pptx"', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    // Default stream for pass2 (tools disabled): return some assistant content.
    mock.mockImplementation(() =>
      stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]),
    );

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_pptx_upskill_1',
            name: 'document_generate',
            args: JSON.stringify({
              action: 'upskill',
              format: 'pptx',
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
        content: 'teach me pptx generation',
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
        (e.data as any)?.tool_call_id === 'tool_pptx_upskill_1',
    );
    expect(resultEvent).toBeDefined();
    const resultData = resultEvent!.data as any;
    expect(resultData.result.status).toBe('completed');
    expect(resultData.result.mode).toBe('upskill');
    expect(resultData.result.format).toBe('pptx');
    expect(typeof resultData.result.skill).toBe('string');
    expect(resultData.result.skill.length).toBeGreaterThan(0);
    expect(String(resultData.result.skill)).toContain('PPTX');
  });

  it('persists a completed pptx_generate job and returns a downloadUrl', async () => {
    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    const freeformMock = generateFreeformPptx as unknown as ReturnType<typeof vi.fn>;

    // Default stream for pass2 (tools disabled): return some assistant content.
    mock.mockImplementation(() =>
      stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]),
    );

    freeformMock.mockResolvedValueOnce({
      buffer: Buffer.from('fake-pptx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileName: 'freeform-output.pptx',
    });

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_pptx_freeform_1',
            name: 'document_generate',
            args: JSON.stringify({
              action: 'generate',
              format: 'pptx',
              code: 'return pptx({ title: "Demo" })',
              entityType: 'folder',
              entityId: folderId,
              title: 'Demo presentation',
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
        content: 'generate a pptx',
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
        (e.data as any)?.tool_call_id === 'tool_pptx_freeform_1',
    );
    expect(resultEvent).toBeDefined();
    const resultData = resultEvent!.data as any;
    expect(resultData.result.status).toBe('completed');
    expect(resultData.result.mode).toBe('freeform');
    expect(resultData.result.format).toBe('pptx');
    expect(typeof resultData.result.jobId).toBe('string');
    expect(resultData.result.jobId.length).toBeGreaterThan(0);
    expect(resultData.result.fileName).toContain('.pptx');
    expect(resultData.result.downloadUrl).toContain('/pptx/jobs/');

    expect(freeformMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'folder',
        entityId: folderId,
        workspaceId,
        title: 'Demo presentation',
      }),
    );

    const jobId = String(resultData.result.jobId);
    const [job] = await db.select().from(jobQueue).where(eq(jobQueue.id, jobId)).limit(1);
    expect(job).toBeDefined();
    expect(job?.type).toBe('pptx_generate');
    expect(job?.status).toBe('completed');

    const putMock = putObject as unknown as ReturnType<typeof vi.fn>;
    expect(putMock).toHaveBeenCalled();
    const putCallArg = putMock.mock.calls[0]?.[0] as any;
    expect(String(putCallArg?.key)).toContain('pptx-cache/');
  });
});
