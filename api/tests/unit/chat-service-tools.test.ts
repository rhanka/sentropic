import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import {
  chatMessages,
  chatSessions,
  chatStreamEvents,
  executionEvents,
  executionRuns,
  folders,
  plans,
  tasks,
  todos,
  users,
  workspaces,
  workspaceMemberships,
} from '../../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import { todoOrchestrationService } from '../../src/services/todo-orchestration';

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
    await db.delete(executionEvents).where(eq(executionEvents.workspaceId, workspaceId));
    await db.delete(executionRuns).where(eq(executionRuns.workspaceId, workspaceId));
    await db.delete(tasks).where(eq(tasks.workspaceId, workspaceId));
    await db.delete(todos).where(eq(todos.workspaceId, workspaceId));
    await db.delete(plans).where(eq(plans.workspaceId, workspaceId));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
    vi.clearAllMocks();
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

it('should evaluate reasoning effort with gemini-2.5-flash-lite when provider is gemini', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const calls: any[] = [];
    mock.mockReset();
    mock.mockImplementation((opts: any) => {
      calls.push(opts);
      if (calls.length === 1) {
        return stream([
          { type: 'content_delta', data: { delta: 'low' } },
          { type: 'done', data: {} }
        ]);
      }
      return stream([
        { type: 'content_delta', data: { delta: 'Gemini response' } },
        { type: 'done', data: {} }
      ]);
    });

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'Assess this request',
      primaryContextType: 'folder',
      primaryContextId: folderId,
      providerId: 'gemini',
      model: 'gemini-3.1-pro-preview-customtools'
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      providerId: 'gemini',
      model: msg.model
    });

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.providerId).toBe('gemini');
    expect(calls[0]?.model).toBe('gemini-2.5-flash-lite');
    expect(calls[1]?.providerId).toBe('gemini');
    expect(calls[1]?.model).toBe('gemini-3.1-pro-preview-customtools');

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, msg.assistantMessageId));
    const effortStatus = events.find(
      (e) =>
        e.eventType === 'status' &&
        (e.data as any)?.state === 'reasoning_effort_selected'
    );
    expect(effortStatus).toBeDefined();
    expect((effortStatus as any).data?.effort).toBe('low');
    expect((effortStatus as any).data?.by).toBe('gemini-2.5-flash-lite');
  });

  it('should expose requested web tools without business context', async () => {
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
      content: 'search web without domain context',
      model: 'gpt-4.1-nano'
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['web_search', 'web_extract']
    });

    expect(seenToolNames).toContain('web_search');
    expect(seenToolNames).toContain('web_extract');
  });

  it('should expose and execute unified todo tool when explicitly requested', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const calls: any[] = [];

    mock.mockImplementation((opts: any) => {
      calls.push(opts);
      if (calls.length === 1) {
        return stream([
          {
            type: 'tool_call_start',
            data: {
              tool_call_id: 'call_todo_create_1',
              name: 'todo',
              args: JSON.stringify({
                action: 'create',
                title: 'Release hardening',
                planTitle: 'Release wave',
                tasks: [
                  { title: 'Run regression suite' },
                  { title: 'Publish changelog' }
                ]
              })
            }
          },
          { type: 'done', data: {} }
        ]);
      }
      return stream([
        { type: 'content_delta', data: { delta: 'TODO created.' } },
        { type: 'done', data: {} }
      ]);
    });

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'Create a release TODO with tasks',
      model: 'gpt-4.1-nano'
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['todo']
    });

    const names = toolNames(calls[0]?.tools);
    expect(names).toContain('todo');
    expect(names).not.toContain('todo_create');
    expect(names).not.toContain('todo_update');
    expect(names).not.toContain('task_update');

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, msg.assistantMessageId));
    const resultEvent = events.find(
      (e) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'call_todo_create_1'
    );
    expect(resultEvent).toBeDefined();
    expect((resultEvent as any).data?.result?.status).toBe('completed');
    expect(typeof (resultEvent as any).data?.result?.todoId).toBe('string');
    expect((resultEvent as any).data?.result?.taskCount).toBe(2);
  });

  it('should expose unified todo tool in active TODO mode even when legacy tool id is requested', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const calls: any[] = [];

    mock.mockImplementation((opts: any) => {
      calls.push(opts);
      return stream([
        { type: 'content_delta', data: { delta: 'Progress applied.' } },
        { type: 'done', data: {} }
      ]);
    });

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'Continue and check the TODO progression now',
      model: 'gpt-4.1-nano'
    });

    const created = await todoOrchestrationService.createTodoFromChat(
      { userId, role: 'editor', workspaceId },
      {
        title: 'Active runtime TODO',
        sessionId: msg.sessionId,
        tasks: [{ title: 'First task' }, { title: 'Second task' }],
      },
    );
    expect(created.status).toBe('completed');

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['todo_create']
    });

    const names = toolNames(calls[0]?.tools);
    expect(names).toContain('todo');
    expect(names).not.toContain('todo_create');
    expect(names).not.toContain('todo_update');
    expect(names).not.toContain('task_update');
    expect(calls[0]?.toolChoice).toBe('required');
  });

  it('should keep unified todo tool available when user explicitly asks to replace with a new TODO list', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const calls: any[] = [];

    mock.mockImplementation((opts: any) => {
      calls.push(opts);
      return stream([
        { type: 'content_delta', data: { delta: 'Replacement TODO prepared.' } },
        { type: 'done', data: {} }
      ]);
    });

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'Create a new TODO list and replace the current one',
      model: 'gpt-4.1-nano'
    });

    const created = await todoOrchestrationService.createTodoFromChat(
      { userId, role: 'editor', workspaceId },
      {
        title: 'Current TODO',
        sessionId: msg.sessionId,
        tasks: [{ title: 'Legacy task' }],
      },
    );
    expect(created.status).toBe('completed');

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['todo_create']
    });

    const names = toolNames(calls[0]?.tools);
    expect(names).toContain('todo');
    expect(names).not.toContain('todo_create');
    expect(calls[0]?.toolChoice).toBe('auto');
  });

  it('should continue beyond 10 iterations when active TODO can progress without user input', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const calls: any[] = [];

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'go',
      model: 'gpt-4.1-nano'
    });

    const created = await todoOrchestrationService.createTodoFromChat(
      { userId, role: 'editor', workspaceId },
      {
        title: 'Long autonomous TODO',
        sessionId: msg.sessionId,
        tasks: [{ title: 'Task to keep progressing' }],
      },
    );
    expect(created.status).toBe('completed');
    const todoId =
      created.status === 'completed' && typeof created.todoId === 'string'
        ? created.todoId
        : '';
    expect(todoId).not.toBe('');
    const [taskRow] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.todoId, todoId)))
      .limit(1);
    expect(taskRow?.id).toBeTruthy();

    let passCount = 0;
    mock.mockImplementation((opts: any) => {
      calls.push(opts);
      passCount += 1;
      if (passCount <= 12) {
        return stream([
          {
            type: 'tool_call_start',
            data: {
              tool_call_id: `call_todo_loop_${passCount}`,
              name: 'todo',
              args: JSON.stringify({
                action: 'update_task',
                taskId: taskRow!.id,
                status: 'in_progress',
              })
            }
          },
          { type: 'done', data: {} }
        ]);
      }
      return stream([
        { type: 'content_delta', data: { delta: 'Autonomous progression complete.' } },
        { type: 'done', data: {} }
      ]);
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['todo']
    });

    expect(calls.length).toBeGreaterThan(10);
  });

  it('should inject strict TODO orchestration rules in system prompt when an active session TODO exists', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    let systemPrompt = '';

    mock.mockImplementation((opts: any) => {
      const messages = Array.isArray(opts?.messages) ? opts.messages : [];
      systemPrompt =
        typeof messages[0]?.content === 'string' ? messages[0].content : '';
      return stream([
        { type: 'content_delta', data: { delta: 'Progress applied.' } },
        { type: 'done', data: {} }
      ]);
    });

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'Continue TODO execution',
      model: 'gpt-4.1-nano'
    });

    const created = await todoOrchestrationService.createTodoFromChat(
      { userId, role: 'editor', workspaceId },
      {
        title: 'Runtime TODO',
        sessionId: msg.sessionId,
        tasks: [{ title: 'Task one' }, { title: 'Task two' }],
      },
    );
    expect(created.status).toBe('completed');

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['todo_create']
    });

    expect(systemPrompt).toContain(
      'Prioritize progression of the active TODO before starting unrelated planning.',
    );
    expect(systemPrompt).toContain(
      'Use `todo` with `action="update_task"` and `action="update_todo"` to progress the existing TODO.',
    );
    expect(systemPrompt).toContain(
      'Ask blocker questions upfront in one batch, then continue autonomously until a real blocker appears.',
    );
    expect(systemPrompt).toContain(
      'Structural mutations (add/remove/reorder/replace tasks, or rewrite TODO/task content) require explicit user intent.',
    );
  });

  it('should block structural todo_update mutation without explicit user intent in active TODO mode', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const calls: any[] = [];

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'Continue TODO progression now',
      model: 'gpt-4.1-nano'
    });

    const created = await todoOrchestrationService.createTodoFromChat(
      { userId, role: 'editor', workspaceId },
      {
        title: 'Current TODO title',
        sessionId: msg.sessionId,
        tasks: [{ title: 'A task' }],
      },
    );
    expect(created.status).toBe('completed');
    const todoId =
      created.status === 'completed' && typeof created.todoId === 'string'
        ? created.todoId
        : '';
    expect(todoId).not.toBe('');

    mock.mockImplementation((opts: any) => {
      calls.push(opts);
      if (calls.length === 1) {
        return stream([
          {
            type: 'tool_call_start',
            data: {
              tool_call_id: 'call_todo_update_structural_1',
              name: 'todo',
              args: JSON.stringify({
                action: 'update_todo',
                todoId,
                title: 'Renamed without explicit intent',
                status: 'in_progress'
              })
            }
          },
          { type: 'done', data: {} }
        ]);
      }
      return stream([
        { type: 'content_delta', data: { delta: 'Handled.' } },
        { type: 'done', data: {} }
      ]);
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['todo_create']
    });

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, msg.assistantMessageId));
    const resultEvent = events.find(
      (e) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'call_todo_update_structural_1'
    );
    expect(resultEvent).toBeDefined();
    expect((resultEvent as any).data?.result?.status).toBe('error');
    expect(String((resultEvent as any).data?.result?.error ?? '')).toContain(
      'structural mutation requires explicit user intent',
    );

    const [storedTodo] = await db
      .select({ title: todos.title })
      .from(todos)
      .where(eq(todos.id, todoId))
      .limit(1);
    expect(storedTodo?.title).toBe('Current TODO title');
  });

  it('should allow structural todo_update mutation when user intent is explicit', async () => {
    const mock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
    const calls: any[] = [];

    const msg = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      content: 'Renomme la TODO actuelle en TODO finale',
      model: 'gpt-4.1-nano'
    });

    const created = await todoOrchestrationService.createTodoFromChat(
      { userId, role: 'editor', workspaceId },
      {
        title: 'TODO to rename',
        sessionId: msg.sessionId,
        tasks: [{ title: 'A task' }],
      },
    );
    expect(created.status).toBe('completed');
    const todoId =
      created.status === 'completed' && typeof created.todoId === 'string'
        ? created.todoId
        : '';
    expect(todoId).not.toBe('');

    mock.mockImplementation((opts: any) => {
      calls.push(opts);
      if (calls.length === 1) {
        return stream([
          {
            type: 'tool_call_start',
            data: {
              tool_call_id: 'call_todo_update_structural_2',
              name: 'todo',
              args: JSON.stringify({
                action: 'update_todo',
                todoId,
                title: 'TODO finale',
              })
            }
          },
          { type: 'done', data: {} }
        ]);
      }
      return stream([
        { type: 'content_delta', data: { delta: 'Renamed.' } },
        { type: 'done', data: {} }
      ]);
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId: msg.sessionId,
      assistantMessageId: msg.assistantMessageId,
      model: msg.model,
      tools: ['todo_create']
    });

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, msg.assistantMessageId));
    const resultEvent = events.find(
      (e) =>
        e.eventType === 'tool_call_result' &&
        (e.data as any)?.tool_call_id === 'call_todo_update_structural_2'
    );
    expect(resultEvent).toBeDefined();
    expect((resultEvent as any).data?.result?.status).toBe('completed');

    const [storedTodo] = await db
      .select({ title: todos.title })
      .from(todos)
      .where(eq(todos.id, todoId))
      .limit(1);
    expect(storedTodo?.title).toBe('TODO finale');
  });
});
