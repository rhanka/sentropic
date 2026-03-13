import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Cohere SDK before importing the provider
const mockCohereChat = vi.fn();
const mockCohereChatStream = vi.fn();

vi.mock('cohere-ai', () => {
  class MockCohereClient {
    v2 = {
      chat: mockCohereChat,
      chatStream: mockCohereChatStream,
    };
  }
  return { CohereClient: MockCohereClient };
});

// Mock env to control API key presence
vi.mock('../../src/config/env', () => ({
  env: {
    COHERE_API_KEY: 'test-cohere-key',
  },
}));

import { CohereProviderRuntime } from '../../src/services/providers/cohere-provider';

describe('CohereProviderRuntime', () => {
  let runtime: CohereProviderRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new CohereProviderRuntime();
  });

  describe('provider descriptor', () => {
    it('should have correct provider id and label', () => {
      expect(runtime.provider.providerId).toBe('cohere');
      expect(runtime.provider.label).toBe('Cohere');
    });

    it('should report ready status when API key is configured', () => {
      expect(runtime.provider.status).toBe('ready');
    });

    it('should report correct capabilities', () => {
      expect(runtime.provider.capabilities).toEqual({
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        supportsReasoning: false,
      });
    });
  });

  describe('listModels', () => {
    it('should return Cohere model catalog entries', () => {
      const models = runtime.listModels();
      expect(models).toHaveLength(2);

      const commandA = models.find((m) => m.modelId === 'command-a-03-2025');
      expect(commandA).toBeDefined();
      expect(commandA!.providerId).toBe('cohere');
      expect(commandA!.reasoningTier).toBe('standard');
      expect(commandA!.supportsTools).toBe(true);

      const reasoning = models.find((m) => m.modelId === 'command-a-reasoning-08-2025');
      expect(reasoning).toBeDefined();
      expect(reasoning!.reasoningTier).toBe('advanced');
    });
  });

  describe('validateCredential', () => {
    it('should return ok when env key is configured', () => {
      const result = runtime.validateCredential();
      expect(result.ok).toBe(true);
    });

    it('should return ok when override credential is provided', () => {
      const result = runtime.validateCredential('override-key');
      expect(result.ok).toBe(true);
    });

    it('should return not ok when credential is empty string', () => {
      const result = runtime.validateCredential('  ');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Cohere API key');
    });
  });

  describe('normalizeError', () => {
    it('should normalize error with rate limit status', () => {
      const error = { message: 'Rate limit exceeded', status: 429 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.providerId).toBe('cohere');
      expect(normalized.message).toBe('Rate limit exceeded');
      expect(normalized.retryable).toBe(true);
    });

    it('should normalize error with statusCode field', () => {
      const error = { message: 'Too many requests', statusCode: 429 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.retryable).toBe(true);
    });

    it('should normalize error with code', () => {
      const error = { message: 'Bad request', code: 'invalid_request', status: 400 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.code).toBe('invalid_request');
      expect(normalized.retryable).toBe(false);
    });

    it('should normalize server error as retryable', () => {
      const error = { message: 'Internal error', status: 500 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.retryable).toBe(true);
    });

    it('should handle Error instances', () => {
      const normalized = runtime.normalizeError(new Error('SDK error'));
      expect(normalized.message).toBe('SDK error');
    });

    it('should provide fallback message for unknown errors', () => {
      const normalized = runtime.normalizeError(null);
      expect(normalized.message).toBe('Cohere request failed');
    });
  });

  describe('generate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.generate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should call Cohere v2.chat', async () => {
      mockCohereChat.mockResolvedValue({
        message: { content: [{ type: 'text', text: 'Hello' }] },
      });

      const result = await runtime.generate({
        mode: 'chat',
        requestOptions: {
          model: 'command-a-03-2025',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(mockCohereChat).toHaveBeenCalled();
      expect(result).toEqual({
        message: { content: [{ type: 'text', text: 'Hello' }] },
      });
    });
  });

  describe('streamGenerate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.streamGenerate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should return async iterable from Cohere stream', async () => {

      const events = [
        { type: 'content-delta', delta: { message: { content: { text: 'Hi' } } } },
        { type: 'message-end' },
      ];

      mockCohereChatStream.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
        },
      });

      const iterable = await runtime.streamGenerate({
        mode: 'chat',
        requestOptions: {
          model: 'command-a-03-2025',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      const collected: unknown[] = [];
      for await (const event of iterable) {
        collected.push(event);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0]).toEqual(events[0]);
    });
  });
});
