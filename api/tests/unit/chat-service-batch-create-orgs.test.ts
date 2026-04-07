import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import {
  chatMessages,
  chatSessions,
  chatStreamEvents,
  folders,
  jobQueue,
  organizations,
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

// Mock queue-manager to avoid real job processing during tests.
// addJob inserts a completed row so the poll loop exits immediately.
vi.mock('../../src/services/queue-manager', async () => {
  const { db: testDb } = await import('../../src/db/client');
  const { organizations: orgsTable, jobQueue: jqTable } = await import('../../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { sql } = await import('drizzle-orm');
  return {
    queueManager: {
      addJob: vi.fn(async (type: string, data: any, opts?: any) => {
        const jobId = `mock-job-${Math.random().toString(36).slice(2, 10)}`;
        // Insert a completed job row so the poll loop resolves
        await testDb.run(sql`
          INSERT INTO job_queue (id, type, data, status, created_at, workspace_id)
          VALUES (${jobId}, ${type}, ${JSON.stringify(data)}, 'completed', ${new Date()}, ${opts?.workspaceId ?? 'default'})
        `);
        // Also mark the organization as completed (simulating enrichment)
        if (type === 'organization_enrich' && data.organizationId) {
          await testDb.update(orgsTable)
            .set({ status: 'completed' })
            .where(eq(orgsTable.id, data.organizationId));
        }
        return jobId;
      }),
    },
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

describe('ChatService - batch_create_organizations tool (unit, mocked OpenAI)', () => {
  let userId: string;
  let workspaceId: string;
  let folderId: string;

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `batch-orgs-test-${userId}@example.com`,
      displayName: 'BatchOrgs Test User',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    ({ workspaceId } = await ensureWorkspaceForUser(userId));

    folderId = createId();
    await db.insert(folders).values({
      id: folderId,
      workspaceId,
      name: 'Folder for batch_create_organizations tests',
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
    await db.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await db.delete(organizations).where(eq(organizations.workspaceId, workspaceId));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
    vi.clearAllMocks();
  });

  it('should include batch_create_organizations in tool list for opportunity workspace', async () => {
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
        content: 'create organizations',
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

    expect(capturedTools).toContain('batch_create_organizations');
  });

  it('should include batch_create_organizations for ai-ideas workspace (same tools as opportunity)', async () => {
    await db.update(workspaces).set({ type: 'ai-ideas' }).where(eq(workspaces.id, workspaceId));

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
        content: 'create organizations',
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

    expect(capturedTools).toContain('batch_create_organizations');
  });

  it('should NOT include batch_create_organizations for neutral workspace', async () => {
    // ensureWorkspaceForUser creates neutral by default, no update needed

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
        content: 'create organizations',
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

    expect(capturedTools).not.toContain('batch_create_organizations');
  });

  it('should handle batch_create_organizations tool call and produce a result event', async () => {
    await db.update(workspaces).set({ type: 'opportunity' }).where(eq(workspaces.id, workspaceId));

    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_batch_orgs_1',
            name: 'batch_create_organizations',
            args: JSON.stringify({
              description: 'Create 3 tech companies: Acme Corp (AI), Beta Inc (Cloud), Gamma Ltd (IoT)',
              workspaceId,
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
        content: 'create organizations from description',
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
      (e: any) => e.eventType === 'tool_call_result' && (e.data as any)?.tool_call_id === 'tool_batch_orgs_1',
    );
    expect(resultEvent).toBeDefined();
    const resultData = resultEvent!.data as any;
    expect(resultData.result.status).toBe('completed');
    expect(resultData.result.workspaceId).toBe(workspaceId);
    expect(resultData.result.totalCreated).toBe(3);
    expect(resultData.result.totalEnriched).toBe(3);
    expect(resultData.result.organizations).toHaveLength(3);
  });

  it('should reject batch_create_organizations when description is missing', async () => {
    await db.update(workspaces).set({ type: 'opportunity' }).where(eq(workspaces.id, workspaceId));

    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;

    mock.mockImplementationOnce(() =>
      stream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_batch_orgs_nodesc',
            name: 'batch_create_organizations',
            args: JSON.stringify({
              workspaceId,
              // description deliberately omitted
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
        content: 'batch create orgs',
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
        (e.data as any)?.tool_call_id === 'tool_batch_orgs_nodesc' &&
        (e.data as any)?.result?.status === 'error',
    );
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.data as any).result.error).toContain('description');
  });
});
