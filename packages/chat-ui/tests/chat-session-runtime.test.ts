import { describe, expect, it, vi } from 'vitest';

import {
  createChatSessionRuntime,
  type ChatSessionRuntimeMessage,
  type ChatSessionPendingTool,
} from '../src/state/chatSessionRuntime.js';

const createStreamClient = () => ({
  set: vi.fn((_key: string, _onEvent: (event: unknown) => void) => {}),
  delete: vi.fn((_key: string) => {}),
});

const createPendingTool = (): ChatSessionPendingTool => ({
  toolCallId: 'tool-1',
  streamId: 'stream-1',
  name: 'tab_read',
  args: { include: 'title' },
  request: {
    requestId: 'request-1',
    toolName: 'tab_read',
    origin: 'test',
  },
  createdAt: 10,
});

const createMessage = (): ChatSessionRuntimeMessage => ({
  id: 'msg-1',
  role: 'user',
  content: 'Hello',
  sequence: 1,
});

describe('ChatSessionRuntime', () => {
  it('should attach live IO idempotently when called twice with the same host', () => {
    const streamClient = createStreamClient();
    const runtime = createChatSessionRuntime('session-1', {
      pollJob: async () => ({ status: 'pending' }),
    });
    const host = { transport: {}, streamClient };

    runtime.attach(host);
    runtime.attach(host);

    expect(streamClient.set).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().attachGeneration).toBe(1);
  });

  it('should update the next snapshot through commands', () => {
    const runtime = createChatSessionRuntime('session-1', {});

    runtime.setDraft('Draft text');
    runtime.setAttachments([{ id: 'att-1', kind: 'image', state: 'ready' }]);

    const snapshot = runtime.snapshot();
    expect(snapshot.draft).toBe('Draft text');
    expect(snapshot.attachments).toEqual([
      { id: 'att-1', kind: 'image', state: 'ready' },
    ]);
    expect(snapshot.attachmentSummary.ready).toBe(1);
  });

  it('should notify subscribers immediately, on change, and stop after unsubscribe', () => {
    const runtime = createChatSessionRuntime('session-1', {});
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
    const runtime = createChatSessionRuntime('session-1', {});
    const message = createMessage();
    const pendingTool = createPendingTool();

    runtime.setMessages([message]);
    runtime.setDraft('Persist me');
    runtime.setAttachments([{ id: 'att-1', kind: 'image', state: 'ready' }]);
    runtime.setCheckpoints([{ id: 'checkpoint-1', anchorMessageId: 'msg-1' }]);
    runtime.setTodo({ tasks: [{ id: 'todo-1', title: 'Inspect' }] });
    runtime.setPendingTool(pendingTool);
    runtime.setLastAppliedSequence(42);

    const restored = createChatSessionRuntime('session-1', {});
    restored.restore(runtime.serialize());

    const snapshot = restored.snapshot();
    expect(snapshot.messages).toEqual([message]);
    expect(snapshot.draft).toBe('Persist me');
    expect(snapshot.attachments).toEqual([
      { id: 'att-1', kind: 'image', state: 'ready' },
    ]);
    expect(snapshot.checkpoints).toEqual([
      { id: 'checkpoint-1', anchorMessageId: 'msg-1' },
    ]);
    expect(snapshot.todo).toEqual({
      tasks: [{ id: 'todo-1', title: 'Inspect' }],
    });
    expect(snapshot.pendingTool).toEqual(pendingTool);
    expect(snapshot.lastAppliedSequence).toBe(42);
  });

  it('should tear down live IO once when disposed repeatedly', () => {
    const streamClient = createStreamClient();
    const runtime = createChatSessionRuntime('session-1', {
      pollJob: async () => ({ status: 'pending' }),
    });

    runtime.attach({ transport: {}, streamClient });
    runtime.dispose();
    runtime.dispose();

    expect(streamClient.delete).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot().disposed).toBe(true);
  });
});
