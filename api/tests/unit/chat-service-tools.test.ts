import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import { chatMessages, chatSessions, chatStreamEvents, folders, users, workspaces } from '../../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';

// Mock OpenAI streaming to keep unit tests deterministic and fast.
// IMPORTANT: this must be declared before importing chatService.
vi.mock('../../src/services/openai', () => {
  return {
    callOpenAIResponseStream: vi.fn(),
  };
});

import { callOpenAIResponseStream } from '../../src/services/openai';
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

describe('ChatService - tools wiring (unit, mocked OpenAI)', () => {
  let userId: string;
  let workspaceId: string;
  let folderId: string;

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `test-${userId}@example.com`,
      displayName: 'Test User',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Ensure owner workspace exists (ChatService relies on it).
    ({ workspaceId } = await ensureWorkspaceForUser(userId));

    folderId = createId();
    await db.insert(folders).values({
      id: folderId,
      workspaceId,
      name: 'Folder for chat-service unit tests',
      description: 'Desc',
      matrixConfig: JSON.stringify({ valueAxes: [], complexityAxes: [] }),
      executiveSummary: JSON.stringify({ introduction: 'Hello' }),
      status: 'completed',
      createdAt: new Date()
    });
  });

  afterEach(async () => {
    // Cleanup stream events/messages/sessions created during tests
    await db.delete(chatStreamEvents);
    await db.delete(chatMessages);
    await db.delete(chatSessions).where(eq(chatSessions.userId, userId));
    await db.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it('should enable expected tools per primaryContextType and always include web_search/web_extract', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const seen: Array<{ context: string; names: string[] }> = [];
    mock.mockImplementation((opts: any) => {
      const tools = toolNames(opts?.tools);
      // store current context from system prompt line (cheap) or just from "tools" set in callsite
      seen.push({ context: 'unknown', names: tools });
      // Provide minimal content to avoid ChatService second-pass "no content" error.
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} }
      ]);
    });

    const contexts: Array<{ primaryContextType: 'usecase' | 'organization' | 'folder' | 'executive_summary'; primaryContextId: string | null }> = [
      { primaryContextType: 'usecase', primaryContextId: createId() },
      { primaryContextType: 'organization', primaryContextId: createId() },
      { primaryContextType: 'folder', primaryContextId: folderId },
      { primaryContextType: 'executive_summary', primaryContextId: folderId },
    ];

    for (const ctx of contexts) {
      const { sessionId, assistantMessageId, model } = await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'test',
        primaryContextType: ctx.primaryContextType,
        primaryContextId: ctx.primaryContextId,
        model: 'gpt-4.1-nano'
      });
      await chatService.runAssistantGeneration({ userId, sessionId, assistantMessageId, model });
    }

    // One call per context (no tools invoked, only a single iteration).
    expect(seen.length).toBe(4);

    // web tools must be available everywhere
    for (const s of seen) {
      expect(s.names).toContain('web_search');
      expect(s.names).toContain('web_extract');
    }

    // Spot-check: folder context has matrix + exec summary + list usecases.
    const folderTools = seen.map((s) => s.names).find((names) => names.includes('matrix_get'));
    expect(folderTools).toBeDefined();
    if (folderTools) {
      expect(folderTools).toContain('folders_list');
      expect(folderTools).toContain('folder_get');
      expect(folderTools).toContain('usecases_list');
      expect(folderTools).toContain('executive_summary_get');
      expect(folderTools).toContain('matrix_get');
      // updates enabled in non-readonly context
      expect(folderTools).toContain('matrix_update');
      expect(folderTools).toContain('executive_summary_update');
      expect(folderTools).toContain('folder_update');
    }

    // Spot-check: organization context provides organizations_list + organization_get (+ update in non-readonly)
    const orgTools = seen.map((s) => s.names).find((names) => names.includes('organizations_list'));
    expect(orgTools).toBeDefined();
    if (orgTools) {
      expect(orgTools).toContain('organizations_list');
      expect(orgTools).toContain('organization_get');
      expect(orgTools).toContain('organization_update');
      expect(orgTools).toContain('folders_list');
    }
  });

  it('should execute matrix_get tool call and enforce context security (folderId must match)', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;

    // First message: successful matrix_get then final content.
    mock
      .mockImplementationOnce(() =>
        stream([
          {
            type: 'tool_call_start',
            data: { tool_call_id: 'call_mx_1', name: 'matrix_get', args: JSON.stringify({ folderId }) }
          },
          { type: 'done', data: {} }
        ])
      )
      .mockImplementationOnce(() =>
        stream([
          { type: 'content_delta', data: { delta: 'OK' } },
          { type: 'done', data: {} }
        ])
      );

    const msg1 = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'matrix',
      primaryContextType: 'folder',
      primaryContextId: folderId,
      model: 'gpt-4.1-nano'
    });
    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg1.sessionId,
      assistantMessageId: msg1.assistantMessageId,
      model: msg1.model
    });

    const events1 = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, msg1.assistantMessageId));
    const result1 = events1.find((e) => e.eventType === 'tool_call_result' && (e.data as any)?.tool_call_id === 'call_mx_1');
    expect(result1).toBeDefined();
    expect((result1 as any).data?.result?.status).toBe('completed');
    expect((result1 as any).data?.result?.folderId).toBe(folderId);

    // Second message: matrix_get with wrong folderId -> security error.
    const otherFolderId = createId();
    await db.insert(folders).values({
      id: otherFolderId,
      workspaceId,
      name: 'Other folder',
      description: 'Other',
      matrixConfig: JSON.stringify({ valueAxes: [], complexityAxes: [] }),
      executiveSummary: JSON.stringify({ introduction: 'Other' }),
      status: 'completed',
      createdAt: new Date()
    });

    mock
      .mockImplementationOnce(() =>
        stream([
          {
            type: 'tool_call_start',
            data: { tool_call_id: 'call_mx_2', name: 'matrix_get', args: JSON.stringify({ folderId: otherFolderId }) }
          },
          { type: 'done', data: {} }
        ])
      )
      .mockImplementationOnce(() =>
        stream([
          { type: 'content_delta', data: { delta: 'OK' } },
          { type: 'done', data: {} }
        ])
      );

    const msg2 = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'matrix wrong',
      sessionId: msg1.sessionId,
      primaryContextType: 'folder',
      primaryContextId: folderId,
      model: 'gpt-4.1-nano'
    });
    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg2.sessionId,
      assistantMessageId: msg2.assistantMessageId,
      model: msg2.model
    });

    const events2 = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, msg2.assistantMessageId));
    const result2 = events2.find((e) => e.eventType === 'tool_call_result' && (e.data as any)?.tool_call_id === 'call_mx_2');
    expect(result2).toBeDefined();
    expect((result2 as any).data?.result?.status).toBe('error');
    expect(String((result2 as any).data?.result?.error ?? '')).toContain('Security: folderId does not match allowed contexts');

    // Cleanup extra folder (avoid leaking across tests)
    await db.delete(folders).where(and(eq(folders.id, otherFolderId), eq(folders.workspaceId, workspaceId)));
  });

  it('should merge local tool definitions, pause on local tool call, and prepare resume payload', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    let seenToolNames: string[] = [];

    mock.mockImplementation((opts: any) => {
      seenToolNames = toolNames(opts?.tools);
      return stream([
        { type: 'status', data: { response_id: 'resp_local_pause_1' } },
        {
          type: 'tool_call_start',
          data: { tool_call_id: 'call_local_tab_info_1', name: 'tab_info', args: '{}' }
        },
        { type: 'done', data: {} }
      ]);
    });

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'inspect active tab',
      primaryContextType: 'folder',
      primaryContextId: folderId,
      model: 'gpt-4.1-nano'
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      localToolDefinitions: [
        {
          name: 'tab_info',
          description: 'Return metadata for the active tab',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      ]
    });

    expect(seenToolNames).toContain('tab_info');

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, msg.assistantMessageId));
    const hasAwaitingState = events.some(
      (e) =>
        e.eventType === 'status' &&
        (e.data as any)?.state === 'awaiting_local_tool_results'
    );
    const hasDone = events.some((e) => e.eventType === 'done');
    expect(hasAwaitingState).toBe(true);
    expect(hasDone).toBe(false);

    const accepted = await chatService.acceptLocalToolResult({
      assistantMessageId: msg.assistantMessageId,
      toolCallId: 'call_local_tab_info_1',
      result: { title: 'Example', url: 'https://example.com' }
    });

    expect(accepted.readyToResume).toBe(true);
    expect(accepted.waitingForToolCallIds).toEqual([]);
    expect(accepted.resumeFrom?.previousResponseId).toBe('resp_local_pause_1');
    expect(accepted.resumeFrom?.toolOutputs).toEqual([
      expect.objectContaining({ callId: 'call_local_tab_info_1' })
    ]);
  });

  it('should keep local tools available when server tool filter is provided', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    let seenToolNames: string[] = [];

    mock.mockImplementation((opts: any) => {
      seenToolNames = toolNames(opts?.tools);
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} }
      ]);
    });

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'read current tab',
      primaryContextType: 'folder',
      primaryContextId: folderId,
      model: 'gpt-4.1-nano'
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['web_search', 'web_extract'],
      localToolDefinitions: [
        {
          name: 'tab_read',
          description: 'Read active tab data',
          parameters: {
            type: 'object',
            properties: {
              mode: { type: 'string' }
            },
            required: ['mode']
          }
        }
      ]
    });

    expect(seenToolNames).toContain('tab_read');
    expect(seenToolNames).toContain('web_search');
  });
});
