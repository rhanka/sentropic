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
