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
