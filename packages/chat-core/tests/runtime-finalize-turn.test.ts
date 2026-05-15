/**
 * BR14b Lot 21e-3 — `ChatRuntime.finalizeAssistantIteration` +
 * `ChatRuntime.emitFinalAssistantTurn` unit tests.
 *
 * Exercises the verbatim port of the post-`consumeToolCalls` blocks
 * previously hosted in `ChatService.runAssistantGeneration`
 * (chat-service.ts lines 3618-3781 + 3892-3902 pre-Lot 21e-3).
 *
 * `finalizeAssistantIteration` covers three sub-blocks per iteration:
 *   - Block A — trace executed tools (verbatim chat-trace callback
 *     invocation) + todo runtime refresh (refetch + status reclass).
 *   - Block B — `pendingLocalToolCalls` short-circuit:
 *     `status:awaiting_local_tool_results` event emitted and caller is
 *     signaled to exit via `shouldExitGeneration: true`.
 *   - Block C — assistant text history append +
 *     `needsExplicitToolReplay` rawInput rebuild for Codex / Anthropic /
 *     Mistral / Cohere providers.
 *
 * `emitFinalAssistantTurn` covers the post-while-loop terminal slice:
 *   - emit a single `done` stream event.
 *   - persist final content + reasoning via
 *     `MessageStore.updateAssistantContent`.
 *   - touch session via `SessionStore.touchUpdatedAt`.
 *
 * Tests use the `InMemoryStreamBuffer` + `InMemoryStreamSequencer` +
 * `InMemoryMessageStore` + `InMemorySessionStore` reference adapters to
 * exercise the boundary contract end-to-end (same fixture convention as
 * the Lot 21c/21e-1/21e-2 test files).
 */
import { describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatRuntimeDeps,
  FinalizeAssistantIterationInput,
  EmitFinalAssistantTurnInput,
  NormalizedVsCodeCodeAgentRuntimePayload,
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
  return {
    runtime: new ChatRuntime(deps),
    streamBuffer,
    streamSequencer,
    messageStore,
    sessionStore,
    deps,
  };
};

const buildIterationInput = (
  overrides: Partial<FinalizeAssistantIterationInput> = {},
): FinalizeAssistantIterationInput => ({
  streamId: 'msg-assistant-1',
  traceEnabled: false,
  sessionId: 'sess-1',
  assistantMessageId: 'msg-assistant-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  iteration: 1,
  modelId: 'gpt-test',
  toolChoice: 'auto',
  tools: null,
  currentMessages: [{ role: 'system', content: 'You are helpful.' }],
  previousResponseId: 'resp-123',
  responseToolOutputs: [],
  toolCalls: [],
  executedTools: [],
  writeChatGenerationTrace: undefined,
  todoAutonomousExtensionEnabled: false,
  todoAwaitingUserInput: false,
  refreshSessionTodoRuntime: undefined,
  currentUserRole: 'editor',
  pendingLocalToolCalls: [],
  localTools: [],
  vscodeCodeAgentPayload: null,
  streamSeq: 10,
  useCodexTransport: false,
  providerId: 'openai',
  contentParts: [],
  ...overrides,
});

describe('ChatRuntime.finalizeAssistantIteration (Lot 21e-3)', () => {
  it('happy path: no tool calls, no local tools, returns shouldExitGeneration=false and rawInput=[]', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        contentParts: ['Hello world'],
      }),
    );
    expect(result.shouldExitGeneration).toBe(false);
    expect(result.streamSeq).toBe(10);
    expect(result.previousResponseId).toBe('resp-123');
    expect(result.pendingResponsesRawInput).toEqual([]);
    // Assistant text appended to history (single new role:'assistant' entry).
    expect(result.currentMessages).toHaveLength(2);
    expect(result.currentMessages[1]).toEqual({
      role: 'assistant',
      content: 'Hello world',
    });
    // No events emitted on the happy path (trace callback undefined).
    expect(streamBuffer.snapshot('msg-assistant-1')).toHaveLength(0);
  });

  it('Block A: invokes writeChatGenerationTrace callback with executed_tools payload', async () => {
    const { runtime } = buildFixture();
    const traceFn = vi.fn(async () => undefined);
    await runtime.finalizeAssistantIteration(
      buildIterationInput({
        traceEnabled: true,
        writeChatGenerationTrace: traceFn,
        iteration: 3,
        toolChoice: 'required',
        tools: [{ type: 'function', function: { name: 'web_search' } }],
        toolCalls: [
          { id: 'tc-1', name: 'web_search', args: '{"query":"x"}' },
        ],
        executedTools: [
          {
            toolCallId: 'tc-1',
            name: 'web_search',
            args: { query: 'x' },
            result: { status: 'ok' },
          },
        ],
        contentParts: ['hi'],
      }),
    );
    expect(traceFn).toHaveBeenCalledTimes(1);
    const call = traceFn.mock.calls[0]?.[0];
    expect(call?.enabled).toBe(true);
    expect(call?.phase).toBe('pass1');
    expect(call?.iteration).toBe(3);
    expect(call?.toolChoice).toBe('required');
    expect(call?.openaiMessages.kind).toBe('executed_tools');
    expect(call?.openaiMessages.previous_response_id).toBe('resp-123');
    expect(call?.toolCalls).toHaveLength(1);
    expect(call?.toolCalls[0]).toEqual({
      id: 'tc-1',
      name: 'web_search',
      args: { query: 'x' },
      result: { status: 'ok' },
    });
    expect(call?.meta.kind).toBe('executed_tools');
    expect(call?.meta.callSite).toBe(
      'ChatService.runAssistantGeneration/pass1/afterTools',
    );
  });

  it('Block A: trace skipped when writeChatGenerationTrace is undefined', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        traceEnabled: true,
        // writeChatGenerationTrace omitted on purpose
        toolCalls: [{ id: 'tc-1', name: 'web_search', args: '{}' }],
        executedTools: [
          {
            toolCallId: 'tc-1',
            name: 'web_search',
            args: {},
            result: { status: 'ok' },
          },
        ],
        contentParts: ['hi'],
      }),
    );
    expect(result.shouldExitGeneration).toBe(false);
    // No throw — runs to completion.
  });

  it('Block A: todo refresh invoked when autonomousExtensionEnabled=true and not awaiting user input', async () => {
    const { runtime } = buildFixture();
    const refreshFn = vi.fn(async () => ({
      hasRefreshedSessionTodo: true,
      todoContinuationActive: true,
      todoAwaitingUserInputAfterRefresh: false,
    }));
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        todoAutonomousExtensionEnabled: true,
        todoAwaitingUserInput: false,
        refreshSessionTodoRuntime: refreshFn,
        contentParts: ['hi'],
      }),
    );
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(refreshFn.mock.calls[0]?.[0]).toEqual({
      sessionId: 'sess-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      currentUserRole: 'editor',
    });
    expect(result.todoContinuationActive).toBe(true);
    expect(result.todoAwaitingUserInput).toBe(false);
  });

  it('Block A: todo refresh sets todoContinuationActive=false when no refreshed snapshot', async () => {
    const { runtime } = buildFixture();
    const refreshFn = vi.fn(async () => ({
      hasRefreshedSessionTodo: false,
      todoContinuationActive: false,
      todoAwaitingUserInputAfterRefresh: false,
    }));
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        todoAutonomousExtensionEnabled: true,
        todoAwaitingUserInput: false,
        refreshSessionTodoRuntime: refreshFn,
        contentParts: ['hi'],
      }),
    );
    expect(result.todoContinuationActive).toBe(false);
    expect(result.todoAwaitingUserInput).toBe(false);
  });

  it('Block A: todo refresh propagates blocking status as todoAwaitingUserInput=true', async () => {
    const { runtime } = buildFixture();
    const refreshFn = vi.fn(async () => ({
      hasRefreshedSessionTodo: true,
      todoContinuationActive: true,
      todoAwaitingUserInputAfterRefresh: true,
    }));
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        todoAutonomousExtensionEnabled: true,
        todoAwaitingUserInput: false,
        refreshSessionTodoRuntime: refreshFn,
        contentParts: ['hi'],
      }),
    );
    expect(result.todoContinuationActive).toBe(true);
    expect(result.todoAwaitingUserInput).toBe(true);
  });

  it('Block A: todo refresh skipped when autonomousExtensionEnabled=false', async () => {
    const { runtime } = buildFixture();
    const refreshFn = vi.fn();
    await runtime.finalizeAssistantIteration(
      buildIterationInput({
        todoAutonomousExtensionEnabled: false,
        refreshSessionTodoRuntime: refreshFn,
        contentParts: ['hi'],
      }),
    );
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('Block A: todo refresh skipped when todoAwaitingUserInput=true', async () => {
    const { runtime } = buildFixture();
    const refreshFn = vi.fn();
    await runtime.finalizeAssistantIteration(
      buildIterationInput({
        todoAutonomousExtensionEnabled: true,
        todoAwaitingUserInput: true,
        refreshSessionTodoRuntime: refreshFn,
        contentParts: ['hi'],
      }),
    );
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it('Block B: pendingLocalToolCalls > 0 emits awaiting_local_tool_results status and signals exit', async () => {
    const { runtime, streamBuffer, streamSequencer } = buildFixture();
    // Pre-allocate up to seq 4 so the next allocate returns 5.
    for (let i = 0; i < 4; i++) {
      await streamSequencer.allocate('msg-assistant-1');
    }
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        previousResponseId: 'resp-456',
        pendingLocalToolCalls: [
          { id: 'tc-1', name: 'local_run_command', args: { cmd: 'ls' } },
        ],
        localTools: [
          {
            type: 'function',
            function: {
              name: 'local_run_command',
              description: 'Run shell command',
              parameters: { type: 'object' },
            },
          },
        ],
        responseToolOutputs: [
          {
            type: 'function_call_output',
            call_id: 'tc-0',
            output: '"prior"',
          },
        ],
        streamSeq: 5,
      }),
    );
    expect(result.shouldExitGeneration).toBe(true);
    expect(result.streamSeq).toBe(6);
    const events = streamBuffer.snapshot('msg-assistant-1');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('status');
    const payload = events[0].data as {
      state: string;
      previous_response_id: string;
      pending_local_tool_calls: ReadonlyArray<{
        tool_call_id: string;
        name: string;
        args: unknown;
      }>;
      local_tool_definitions: ReadonlyArray<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      }>;
      base_tool_outputs: ReadonlyArray<{ call_id: string; output: string }>;
      vscode_code_agent: unknown;
    };
    expect(payload.state).toBe('awaiting_local_tool_results');
    expect(payload.previous_response_id).toBe('resp-456');
    expect(payload.pending_local_tool_calls).toEqual([
      { tool_call_id: 'tc-1', name: 'local_run_command', args: { cmd: 'ls' } },
    ]);
    expect(payload.local_tool_definitions).toEqual([
      {
        name: 'local_run_command',
        description: 'Run shell command',
        parameters: { type: 'object' },
      },
    ]);
    expect(payload.base_tool_outputs).toEqual([
      { call_id: 'tc-0', output: '"prior"' },
    ]);
    expect(payload.vscode_code_agent).toBeUndefined();
  });

  it('Block B: throws when pendingLocalToolCalls present but previousResponseId is null', async () => {
    const { runtime } = buildFixture();
    await expect(
      runtime.finalizeAssistantIteration(
        buildIterationInput({
          previousResponseId: null,
          pendingLocalToolCalls: [
            { id: 'tc-1', name: 'local_run_command', args: {} },
          ],
        }),
      ),
    ).rejects.toThrow(
      'Unable to pause generation for local tools: missing previous_response_id',
    );
  });

  it('Block B: vscodeCodeAgentPayload propagates into status event payload', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const vscodePayload: NormalizedVsCodeCodeAgentRuntimePayload = {
      workspaceKey: 'ws-key',
      workspaceLabel: 'My Workspace',
      promptGlobalOverride: null,
      promptWorkspaceOverride: 'override-text',
      instructionIncludePatterns: ['**/*.ts'],
      instructionFiles: [{ path: 'README.md', content: '# Hello' }],
      systemContext: {
        workingDirectory: '/tmp/proj',
        isGitRepo: true,
        gitBranch: 'main',
        platform: 'linux',
        osVersion: '6.0',
        shell: '/bin/zsh',
        clientDateIso: '2026-05-14T10:00:00Z',
        clientTimezone: 'Europe/Paris',
      },
    };
    await runtime.finalizeAssistantIteration(
      buildIterationInput({
        previousResponseId: 'resp-9',
        pendingLocalToolCalls: [
          { id: 'tc-1', name: 'local_run_command', args: {} },
        ],
        vscodeCodeAgentPayload: vscodePayload,
      }),
    );
    const events = streamBuffer.snapshot('msg-assistant-1');
    const payload = events[0].data as {
      vscode_code_agent: {
        source: string;
        workspace_key: string;
        instruction_files: ReadonlyArray<{ path: string; content: string }>;
        system_context: { working_directory: string; is_git_repo: boolean };
      };
    };
    expect(payload.vscode_code_agent.source).toBe('vscode');
    expect(payload.vscode_code_agent.workspace_key).toBe('ws-key');
    expect(payload.vscode_code_agent.instruction_files).toEqual([
      { path: 'README.md', content: '# Hello' },
    ]);
    expect(payload.vscode_code_agent.system_context.working_directory).toBe(
      '/tmp/proj',
    );
    expect(payload.vscode_code_agent.system_context.is_git_repo).toBe(true);
  });

  it('Block C: needsExplicitToolReplay=true (anthropic) rebuilds rawInput with function_call + function_call_output pairs', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        providerId: 'anthropic',
        toolCalls: [
          { id: 'tc-1', name: 'web_search', args: '{"q":"x"}' },
          { id: 'tc-2', name: 'documents', args: '{}' },
        ],
        responseToolOutputs: [
          {
            type: 'function_call_output',
            call_id: 'tc-1',
            output: '{"status":"ok"}',
          },
          {
            type: 'function_call_output',
            call_id: 'tc-2',
            output: '{"status":"ok"}',
          },
        ],
        contentParts: ['done'],
      }),
    );
    expect(result.shouldExitGeneration).toBe(false);
    expect(result.pendingResponsesRawInput).toHaveLength(4);
    expect(result.pendingResponsesRawInput[0]).toEqual({
      type: 'function_call',
      call_id: 'tc-1',
      name: 'web_search',
      arguments: '{"q":"x"}',
    });
    expect(result.pendingResponsesRawInput[1]).toEqual({
      type: 'function_call_output',
      call_id: 'tc-1',
      output: '{"status":"ok"}',
    });
    expect(result.pendingResponsesRawInput[2]).toEqual({
      type: 'function_call',
      call_id: 'tc-2',
      name: 'documents',
      arguments: '{}',
    });
    expect(result.pendingResponsesRawInput[3]).toEqual({
      type: 'function_call_output',
      call_id: 'tc-2',
      output: '{"status":"ok"}',
    });
  });

  it('Block C: needsExplicitToolReplay=true (useCodexTransport) clears previousResponseId to null', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        useCodexTransport: true,
        providerId: 'openai',
        previousResponseId: 'resp-codex',
        toolCalls: [{ id: 'tc-1', name: 'web_search', args: '{}' }],
        responseToolOutputs: [
          {
            type: 'function_call_output',
            call_id: 'tc-1',
            output: '{}',
          },
        ],
        contentParts: ['done'],
      }),
    );
    expect(result.previousResponseId).toBeNull();
    // raw input rebuilt
    expect(result.pendingResponsesRawInput).toHaveLength(2);
  });

  it('Block C: needsExplicitToolReplay=false (openai) returns responseToolOutputs verbatim', async () => {
    const { runtime } = buildFixture();
    const outputs = [
      {
        type: 'function_call_output' as const,
        call_id: 'tc-1',
        output: '{"status":"ok"}',
      },
    ];
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        providerId: 'openai',
        useCodexTransport: false,
        toolCalls: [{ id: 'tc-1', name: 'web_search', args: '{}' }],
        responseToolOutputs: outputs,
        contentParts: ['done'],
      }),
    );
    expect(result.pendingResponsesRawInput).toEqual(outputs);
    // previousResponseId unchanged on non-codex path.
    expect(result.previousResponseId).toBe('resp-123');
  });

  it('Block C: empty assistant text does NOT append assistant message to currentMessages', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        contentParts: ['   ', '\n', '\t'],
      }),
    );
    // Whitespace-only content -> no append; currentMessages remains unchanged.
    expect(result.currentMessages).toHaveLength(1);
    expect(result.currentMessages[0]).toEqual({
      role: 'system',
      content: 'You are helpful.',
    });
  });

  it('Block C: needsExplicitToolReplay skips toolCalls without matching output', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.finalizeAssistantIteration(
      buildIterationInput({
        providerId: 'mistral',
        toolCalls: [
          { id: 'tc-1', name: 'web_search', args: '{}' },
          { id: 'tc-2', name: 'documents', args: '{}' },
        ],
        responseToolOutputs: [
          // Only tc-1 has an output; tc-2 omitted (e.g. failed before rawInput build).
          {
            type: 'function_call_output',
            call_id: 'tc-1',
            output: '{}',
          },
        ],
        contentParts: ['done'],
      }),
    );
    // 1 pair (function_call + function_call_output) → 2 entries total.
    expect(result.pendingResponsesRawInput).toHaveLength(2);
    expect((result.pendingResponsesRawInput[0] as { call_id: string }).call_id).toBe(
      'tc-1',
    );
  });
});

describe('ChatRuntime.emitFinalAssistantTurn (Lot 21e-3)', () => {
  const buildFinalizeInput = (
    overrides: Partial<EmitFinalAssistantTurnInput> = {},
  ): EmitFinalAssistantTurnInput => ({
    streamId: 'msg-assistant-1',
    assistantMessageId: 'msg-assistant-1',
    sessionId: 'sess-1',
    streamSeq: 100,
    content: 'Final answer',
    reasoning: 'Some reasoning',
    model: 'gpt-test',
    ...overrides,
  });

  it('emits one done event on the stream', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const result = await runtime.emitFinalAssistantTurn(buildFinalizeInput());
    const events = streamBuffer.snapshot('msg-assistant-1');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('done');
    expect(events[0].data).toEqual({});
    // Sequencer allocated 1, so streamSeq = 2.
    expect(result.streamSeq).toBe(2);
  });

  it('persists final content + reasoning via MessageStore.updateAssistantContent', async () => {
    const { runtime, messageStore } = buildFixture();
    const spy = vi.spyOn(messageStore, 'updateAssistantContent');
    await runtime.emitFinalAssistantTurn(
      buildFinalizeInput({
        content: 'Hello!',
        reasoning: 'thinking...',
        model: 'gpt-4.1',
      }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('msg-assistant-1', {
      content: 'Hello!',
      reasoning: 'thinking...',
      model: 'gpt-4.1',
    });
  });

  it('persists null reasoning when caller passes null', async () => {
    const { runtime, messageStore } = buildFixture();
    const spy = vi.spyOn(messageStore, 'updateAssistantContent');
    await runtime.emitFinalAssistantTurn(
      buildFinalizeInput({
        content: 'No reasoning here',
        reasoning: null,
      }),
    );
    expect(spy.mock.calls[0]?.[1].reasoning).toBeNull();
  });

  it('touches session updatedAt via SessionStore.touchUpdatedAt', async () => {
    const { runtime, sessionStore } = buildFixture();
    const spy = vi.spyOn(sessionStore, 'touchUpdatedAt');
    await runtime.emitFinalAssistantTurn(buildFinalizeInput());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('sess-1');
  });
});
