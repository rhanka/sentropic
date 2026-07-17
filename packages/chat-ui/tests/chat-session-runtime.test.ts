import { describe, expect, it, vi } from 'vitest';

import { createChatSessionRuntime } from '../src/state/chatSessionRuntime.js';

const createStreamClient = () => {
  const activeHandlers = new Map<string, (event: unknown) => void>();
  return {
    activeHandlers,
    set: vi.fn((key: string, onEvent: (event: unknown) => void) => {
      activeHandlers.set(key, onEvent);
    }),
    delete: vi.fn((key: string) => {
      activeHandlers.delete(key);
    }),
  };
};

const createTransport = () => ({
  sendMessage: vi.fn(async () => ({
    sessionId: 'session-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    streamId: 'stream-1',
    jobId: 'job-1',
  })),
  retryMessage: vi.fn(async () => ({
    sessionId: 'session-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    streamId: 'stream-1',
    jobId: 'job-1',
  })),
  stopMessage: vi.fn(async () => undefined),
  editMessage: vi.fn(async () => undefined),
  setFeedback: vi.fn(async () => undefined),
  postSteer: vi.fn(async () => undefined),
});

const attachment = {
  id: 'att-1',
  kind: 'image' as const,
  source: 'upload' as const,
  fileName: 'image.png',
  mimeType: 'image/png',
  sizeBytes: 10,
  state: 'ready' as const,
};

const createMessage = () => ({
  id: 'msg-1',
  role: 'user' as const,
  content: 'Hello',
  sequence: 1,
});

const createAssistant = (id: string, streamId: string) => ({
  id,
  role: 'assistant' as const,
  content: null,
  _streamId: streamId,
  _localStatus: 'processing' as const,
});

class PermissionRequiredError extends Error {
  constructor(readonly request: { requestId: string; toolName: string; origin: string }) {
    super('permission required');
  }
}

const createLocalToolMachine = () => {
  const calls = { execute: [] as string[], decide: [] as string[], post: [] as unknown[] };
  const attempts = new Map<string, number>();
  return {
    calls,
    options: {
      executeLocalTool: vi.fn(async (toolCallId: string) => {
        const attempt = (attempts.get(toolCallId) ?? 0) + 1;
        attempts.set(toolCallId, attempt);
        calls.execute.push(toolCallId);
        if (attempt === 1) {
          throw new PermissionRequiredError({
            requestId: `request-${toolCallId}`,
            toolName: 'tab_read',
            origin: 'test',
          });
        }
        return { status: 'ok' };
      }),
      decideLocalToolPermission: vi.fn(async (requestId: string) => {
        calls.decide.push(requestId);
      }),
      postLocalToolResult: vi.fn(async (_streamId: string, _toolCallId: string, result: unknown) => {
        calls.post.push(result);
      }),
      isLocalToolName: (name: string) => name === 'tab_read',
      isLocalToolRuntimeAvailable: () => true,
      isLocalToolPermissionRequired: (error: unknown) => error instanceof PermissionRequiredError,
      getPermissionRequest: (error: unknown) => (error as PermissionRequiredError).request,
    },
  };
};

describe('ChatSessionRuntime', () => {
  it('should attach live IO idempotently when called twice with the same host', () => {
    const streamClient = createStreamClient();
    const runtime = createChatSessionRuntime('session-1');
    const host = { transport: createTransport(), streamClient };

    runtime.attach(host);
    runtime.attach(host);

    expect(streamClient.set).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().attachGeneration).toBe(1);
  });

  it('should project registered stream events through the controller state', () => {
    const streamClient = createStreamClient();
    const runtime = createChatSessionRuntime('session-1');
    runtime.setMessages([createAssistant('assistant-1', 'stream-1')]);
    runtime.attach({ transport: createTransport(), streamClient });

    expect(streamClient.set).toHaveBeenCalledTimes(1);
    const emit = [...streamClient.activeHandlers.values()][0]!;
    emit({ streamId: 'stream-1', type: 'content_delta', sequence: 1, data: { delta: 'controller text' } });
    emit({ streamId: 'stream-1', type: 'done', sequence: 2, data: {} });

    const snapshot = runtime.snapshot();
    expect(snapshot.messages[0]?._localStatus).toBe('completed');
    const segment = snapshot.projectedTimelineItems.find(
      (item) => item.kind === 'assistant-segment',
    );
    expect(segment?.kind === 'assistant-segment' ? segment.segment.content : '').toBe('controller text');
  });

  it('should expose every controller prompt and route permission decisions to its machine', async () => {
    vi.useFakeTimers();
    try {
      const streamClient = createStreamClient();
      const machine = createLocalToolMachine();
      const runtime = createChatSessionRuntime('session-1');
      runtime.setMessages([
        createAssistant('assistant-1', 'stream-1'),
        createAssistant('assistant-2', 'stream-2'),
      ]);
      runtime.attach({ transport: createTransport(), streamClient, localToolMachine: machine.options });
      const emit = [...streamClient.activeHandlers.values()][0]!;

      emit({ streamId: 'stream-1', type: 'tool_call_start', sequence: 1, data: { tool_call_id: 'tool-1', name: 'tab_read', args: '{}' } });
      emit({ streamId: 'stream-2', type: 'tool_call_start', sequence: 1, data: { tool_call_id: 'tool-2', name: 'tab_read', args: '{}' } });
      await vi.runAllTimersAsync();

      const prompts = runtime.snapshot().pendingLocalToolPermissionPrompts;
      expect(prompts).toHaveLength(2);
      await runtime.decideLocalToolPermission(prompts[0]!, 'allow_once');

      expect(machine.calls.decide).toEqual(['request-tool-1']);
      expect(machine.calls.execute).toEqual(['tool-1', 'tool-2', 'tool-1']);
      expect(machine.calls.post).toEqual([{ status: 'ok' }]);
      expect(runtime.snapshot().pendingLocalToolPermissionPrompts).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should detach before re-attaching when host references change', () => {
    const firstStream = createStreamClient();
    const secondStream = createStreamClient();
    const runtime = createChatSessionRuntime('session-1');

    runtime.attach({ transport: createTransport(), streamClient: firstStream });
    runtime.attach({ transport: createTransport(), streamClient: secondStream });

    expect(firstStream.set).toHaveBeenCalledTimes(1);
    expect(firstStream.delete).toHaveBeenCalledTimes(1);
    expect(secondStream.set).toHaveBeenCalledTimes(1);
    expect(secondStream.delete).toHaveBeenCalledTimes(0);
  });

  it('should keep one stream registration across view remounts and remove it only on dispose', () => {
    const streamClient = createStreamClient();
    const runtime = createChatSessionRuntime('session-1');
    runtime.attach({ transport: createTransport(), streamClient });

    const unbindFirst = runtime.bindView();
    unbindFirst();
    runtime.bindView();

    expect(streamClient.set).toHaveBeenCalledTimes(1);
    expect(streamClient.delete).toHaveBeenCalledTimes(0);
    expect(streamClient.activeHandlers.size).toBe(1);

    runtime.dispose();
    runtime.dispose();
    expect(streamClient.delete).toHaveBeenCalledTimes(1);
  });

  it('should forward every interactive command without exposing a controller handle', async () => {
    const transport = createTransport();
    const runtime = createChatSessionRuntime('session-1');
    runtime.attach({ transport });
    const buildAssistantMessage = (base: {
      id: string;
      sessionId: string;
      _streamId: string;
      _localStatus: 'processing';
      role: 'assistant';
      content: null;
      createdAt: string;
    }) => base;

    const sendResult = await runtime.send(
      { content: 'Hello' },
      {
        buildUserMessage: (handle) => ({ id: handle.userMessageId, role: 'user', content: 'Hello' }),
        buildAssistantMessage,
      },
    );
    await runtime.retry('user-1', { providerId: 'provider', model: 'model', buildAssistantMessage });
    await runtime.stop('assistant-1');
    await runtime.edit('user-1', 'Edited');
    await runtime.setFeedback('assistant-1', 'up');

    expect(sendResult).toBeUndefined();
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(transport.retryMessage).toHaveBeenCalledWith('user-1', { providerId: 'provider', model: 'model' });
    expect(transport.stopMessage).toHaveBeenCalledWith('assistant-1');
    expect(transport.editMessage).toHaveBeenCalledWith('user-1', 'Edited');
    expect(transport.setFeedback).toHaveBeenCalledWith('assistant-1', 'up');
    expect(runtime.snapshot().messages.find((message) => message.id === 'user-1')?.content).toBe('Edited');
  });

  it('should update the next snapshot through commands', () => {
    const runtime = createChatSessionRuntime('session-1');

    runtime.setDraft('Draft text');
    runtime.setAttachments([attachment]);

    const snapshot = runtime.snapshot();
    expect(snapshot.draft).toBe('Draft text');
    expect(snapshot.attachments).toEqual([attachment]);
    expect(snapshot.attachmentSummary.ready).toBe(1);
  });

  it('should notify subscribers immediately, on change, and stop after unsubscribe', () => {
    const runtime = createChatSessionRuntime('session-1');
    const drafts: string[] = [];

    const unsubscribe = runtime.subscribe((snapshot) => {
      drafts.push(snapshot.draft);
    });

    runtime.setDraft('first');
    unsubscribe();
    runtime.setDraft('second');

    expect(drafts).toEqual(['', 'first']);
  });

  it('should serialize and restore the quiescent session snapshot', () => {
    const runtime = createChatSessionRuntime('session-1');
    const message = createMessage();

    runtime.setMessages([message]);
    runtime.setDraft('Persist me');
    runtime.setAttachments([attachment]);
    runtime.setCheckpoints([{ id: 'checkpoint-1', anchorMessageId: 'msg-1' }]);
    runtime.setTodo({ tasks: [{ id: 'todo-1', title: 'Inspect' }] });
    runtime.setLastAppliedSequence(42);

    const restored = createChatSessionRuntime('session-1');
    restored.restore(runtime.serialize());

    const snapshot = restored.snapshot();
    expect(snapshot.messages).toEqual([message]);
    expect(snapshot.draft).toBe('Persist me');
    expect(snapshot.attachments).toEqual([attachment]);
    expect(snapshot.checkpoints).toEqual([
      { id: 'checkpoint-1', anchorMessageId: 'msg-1' },
    ]);
    expect(snapshot.todo).toEqual({
      tasks: [{ id: 'todo-1', title: 'Inspect' }],
    });
    expect(snapshot.lastAppliedSequence).toBe(42);
  });

  it('should tear down live IO once when disposed repeatedly', () => {
    const streamClient = createStreamClient();
    const runtime = createChatSessionRuntime('session-1');

    runtime.attach({ transport: createTransport(), streamClient });
    runtime.dispose();
    runtime.dispose();

    expect(streamClient.delete).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().disposed).toBe(true);
  });
});
