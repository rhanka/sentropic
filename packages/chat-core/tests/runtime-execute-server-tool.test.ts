/**
 * BR14b Lot 21d-3 — `ChatRuntime.executeServerTool` unit tests.
 *
 * Exercises the public facade over the `ChatRuntimeDeps.executeServerTool`
 * Option A callback. The facade is intentionally narrow: it forwards the
 * caller-supplied `ExecuteServerToolInput` verbatim to
 * `deps.executeServerTool` and returns the callback's
 * `ExecuteServerToolResult` unchanged. These tests assert that contract.
 *
 * The 1340-line api-side per-tool body lives in
 * `ChatService.executeServerToolInternal` (Lot 21d-2). Lot 21d-3 wires
 * that method behind the chat-core boundary; the runtime stays agnostic
 * of which api-side helpers / captured locals / closures the adapter
 * binds inside the callback.
 *
 * Tests use stubbed `executeServerTool` callbacks (no `InMemory*` adapter
 * wiring needed) because the facade is a pure forward + null check.
 */
import { describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatRuntimeDeps,
  ExecuteServerToolInput,
  ExecuteServerToolResult,
} from '../src/runtime.js';
import type { ChatState } from '../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
  InMemoryStreamSequencer,
} from '../src/in-memory/index.js';

const buildFixture = (overrides: Partial<ChatRuntimeDeps> = {}) => {
  const messageStore = new InMemoryMessageStore();
  const sessionStore = new InMemorySessionStore();
  const streamBuffer = new InMemoryStreamBuffer();
  const streamSequencer = new InMemoryStreamSequencer();
  const checkpointStore = new InMemoryCheckpointStore<ChatState>();
  const mesh = new InMemoryMeshDispatch();
  const deps: ChatRuntimeDeps = {
    messageStore,
    sessionStore,
    streamBuffer,
    streamSequencer,
    checkpointStore,
    mesh,
    normalizeVsCodeCodeAgent: () => null,
    resolveModelSelection: async () => ({
      provider_id: 'openai',
      model_id: 'gpt-test',
    }),
    normalizeMessageContexts: () => [],
    isChatContextType: () => false,
    resolveSessionWorkspaceId: async () => null,
    listSessionDocuments: async () => [],
    listAssistantDetailsByMessageId: async () => ({}),
    resolveWorkspaceAccess: async () => ({
      readOnly: false,
      canWrite: true,
      currentUserRole: 'editor',
    }),
    ...overrides,
  };
  return { runtime: new ChatRuntime(deps), deps };
};

const buildInput = (
  overrides: Partial<ExecuteServerToolInput> = {},
): ExecuteServerToolInput => ({
  userId: 'user-1',
  sessionId: 'sess-1',
  assistantMessageId: 'msg-assistant-1',
  workspaceId: 'ws-1',
  toolCall: { id: 'tc-1', name: 'read_initiative', args: '{}' },
  streamSeq: 5,
  currentMessages: [{ role: 'system', content: 'You are helpful.' }],
  tools: null,
  responseToolOutputs: [],
  providerId: 'openai',
  modelId: 'gpt-test',
  enforceTodoUpdateMode: false,
  todoAutonomousExtensionEnabled: false,
  contextBudgetReplanAttempts: 0,
  readOnly: false,
  ...overrides,
});

describe('ChatRuntime.executeServerTool (Lot 21d-3)', () => {
  it('forwards the input verbatim to deps.executeServerTool', async () => {
    const stub = vi.fn(async () => ({
      output: { status: 'completed', payload: 'ok' },
      outputForModel: '{"status":"completed","payload":"ok"}',
      success: true,
    }));
    const { runtime } = buildFixture({ executeServerTool: stub });
    const input = buildInput();
    await runtime.executeServerTool(input);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledWith(input);
  });

  it('returns the ExecuteServerToolResult returned by the callback unchanged', async () => {
    const expectedResult: ExecuteServerToolResult = {
      output: { foo: 'bar' },
      outputForModel: '{"foo":"bar"}',
      success: true,
    };
    const { runtime } = buildFixture({
      executeServerTool: async () => expectedResult,
    });
    const result = await runtime.executeServerTool(buildInput());
    expect(result).toBe(expectedResult);
  });

  it('throws when deps.executeServerTool is undefined (not wired)', async () => {
    const { runtime } = buildFixture(); // no executeServerTool override
    await expect(
      runtime.executeServerTool(buildInput()),
    ).rejects.toThrow(/executeServerTool is not wired/);
  });

  it('propagates a callback rejection verbatim (error path mirrors inline try/catch)', async () => {
    const boom = new Error('tool dispatch failed');
    const { runtime } = buildFixture({
      executeServerTool: async () => {
        throw boom;
      },
    });
    await expect(runtime.executeServerTool(buildInput())).rejects.toBe(boom);
  });

  it('preserves toolCall fields (id, name, args) across the boundary', async () => {
    let receivedToolCall: ExecuteServerToolInput['toolCall'] | null = null;
    const { runtime } = buildFixture({
      executeServerTool: async (input) => {
        receivedToolCall = input.toolCall;
        return { output: null, outputForModel: 'null', success: true };
      },
    });
    const toolCall = { id: 'call_xyz-123', name: 'update_initiative', args: '{"id":"x"}' };
    await runtime.executeServerTool(buildInput({ toolCall }));
    expect(receivedToolCall).toEqual(toolCall);
  });

  it('passes the streamSeq cursor through to the callback', async () => {
    let receivedSeq: number | null = null;
    const { runtime } = buildFixture({
      executeServerTool: async (input) => {
        receivedSeq = input.streamSeq;
        return { output: null, outputForModel: 'null', success: true };
      },
    });
    await runtime.executeServerTool(buildInput({ streamSeq: 42 }));
    expect(receivedSeq).toBe(42);
  });

  it('propagates a success:false result with errorMessage (error envelope from inline catch wrap)', async () => {
    const errorEnvelope: ExecuteServerToolResult = {
      output: { status: 'error', error: 'Unknown tool: foo' },
      outputForModel: '{"status":"error","error":"Unknown tool: foo"}',
      success: false,
      errorMessage: 'Unknown tool: foo',
    };
    const { runtime } = buildFixture({
      executeServerTool: async () => errorEnvelope,
    });
    const result = await runtime.executeServerTool(
      buildInput({ toolCall: { id: 'tc-err', name: 'foo', args: '{}' } }),
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Unknown tool: foo');
    expect(result.output).toEqual({ status: 'error', error: 'Unknown tool: foo' });
  });

  it('propagates the optional todoStateUpdate field (plan-branch marker)', async () => {
    const { runtime } = buildFixture({
      executeServerTool: async () => ({
        output: { status: 'completed', todoRuntime: { todoId: 'todo-1' } },
        outputForModel: '{"status":"completed"}',
        success: true,
        todoStateUpdate: { status: 'completed', todoRuntime: { todoId: 'todo-1' } },
      }),
    });
    const result = await runtime.executeServerTool(
      buildInput({ toolCall: { id: 'tc-plan', name: 'plan', args: '{"action":"create"}' } }),
    );
    expect(result.todoStateUpdate).toEqual({
      status: 'completed',
      todoRuntime: { todoId: 'todo-1' },
    });
  });

  it('propagates the optional contextBudgetReplan flag (Lot 21e gate)', async () => {
    const { runtime } = buildFixture({
      executeServerTool: async () => ({
        output: { status: 'context_budget_replan' },
        outputForModel: '{"status":"context_budget_replan"}',
        success: true,
        contextBudgetReplan: true,
      }),
    });
    const result = await runtime.executeServerTool(buildInput());
    expect(result.contextBudgetReplan).toBe(true);
  });

  it('forwards optional AbortSignal verbatim (signal aborted state preserved)', async () => {
    let receivedSignal: AbortSignal | undefined;
    const { runtime } = buildFixture({
      executeServerTool: async (input) => {
        receivedSignal = input.signal;
        return { output: null, outputForModel: 'null', success: true };
      },
    });
    const controller = new AbortController();
    controller.abort();
    await runtime.executeServerTool(buildInput({ signal: controller.signal }));
    expect(receivedSignal).toBe(controller.signal);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('forwards full input contract (workspaceId, providerId, modelId, readOnly, enforce flags) verbatim', async () => {
    let received: ExecuteServerToolInput | null = null;
    const { runtime } = buildFixture({
      executeServerTool: async (input) => {
        received = input;
        return { output: null, outputForModel: 'null', success: true };
      },
    });
    const input = buildInput({
      workspaceId: 'ws-custom',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      readOnly: true,
      enforceTodoUpdateMode: true,
      todoAutonomousExtensionEnabled: true,
      contextBudgetReplanAttempts: 3,
    });
    await runtime.executeServerTool(input);
    expect(received).not.toBeNull();
    expect(received!.workspaceId).toBe('ws-custom');
    expect(received!.providerId).toBe('gemini');
    expect(received!.modelId).toBe('gemini-2.5-flash');
    expect(received!.readOnly).toBe(true);
    expect(received!.enforceTodoUpdateMode).toBe(true);
    expect(received!.todoAutonomousExtensionEnabled).toBe(true);
    expect(received!.contextBudgetReplanAttempts).toBe(3);
  });

  it('invokes the callback exactly once per executeServerTool call (no internal retry / fan-out)', async () => {
    const stub = vi.fn(async () => ({
      output: { status: 'completed' },
      outputForModel: '{"status":"completed"}',
      success: true,
    }));
    const { runtime } = buildFixture({ executeServerTool: stub });
    await runtime.executeServerTool(buildInput());
    await runtime.executeServerTool(
      buildInput({ toolCall: { id: 'tc-2', name: 'web_search', args: '{}' } }),
    );
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it('forwards tools array and responseToolOutputs (opaque to chat-core, byte-preserved)', async () => {
    let receivedTools: ReadonlyArray<unknown> | null | undefined;
    let receivedOutputs: ReadonlyArray<unknown> | undefined;
    const { runtime } = buildFixture({
      executeServerTool: async (input) => {
        receivedTools = input.tools;
        receivedOutputs = input.responseToolOutputs;
        return { output: null, outputForModel: 'null', success: true };
      },
    });
    const tools = [{ type: 'function', function: { name: 'x' } }];
    const responseToolOutputs = [
      { type: 'function_call_output', call_id: 'c1', output: '{}' },
    ];
    await runtime.executeServerTool(buildInput({ tools, responseToolOutputs }));
    expect(receivedTools).toBe(tools);
    expect(receivedOutputs).toBe(responseToolOutputs);
  });
});
