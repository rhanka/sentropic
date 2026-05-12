import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock env to control API key presence
vi.mock('../../src/config/env', () => ({
  env: {
    MISTRAL_API_KEY: 'test-mistral-key',
  },
}));

import { MistralProviderRuntime } from '../../src/services/providers/mistral-provider';

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const sseResponse = (events: unknown[]) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
};

describe('MistralProviderRuntime', () => {
  let runtime: MistralProviderRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    runtime = new MistralProviderRuntime();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('provider descriptor', () => {
    it('should have correct provider id and label', () => {
      expect(runtime.provider.providerId).toBe('mistral');
      expect(runtime.provider.label).toBe('Mistral AI');
    });

    it('should report ready status when API key is configured', () => {
      expect(runtime.provider.status).toBe('ready');
    });

    it('should report correct capabilities', () => {
      expect(runtime.provider.capabilities).toEqual({
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        supportsReasoning: true,
      });
    });
  });

  describe('listModels', () => {
    it('should return Mistral model catalog entries', () => {
      const models = runtime.listModels();
      expect(models).toHaveLength(2);

      const mistralSmall = models.find((m) => m.modelId === 'mistral-small-2603');
      expect(mistralSmall).toBeDefined();
      expect(mistralSmall!.providerId).toBe('mistral');
      expect(mistralSmall!.reasoningTier).toBe('standard');
      expect(mistralSmall!.supportsTools).toBe(true);

      const large = models.find((m) => m.modelId === 'magistral-medium-2509');
      expect(large).toBeDefined();
      expect(large!.reasoningTier).toBe('advanced');
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
      expect(result.message).toContain('Mistral API key');
    });
  });

  describe('normalizeError', () => {
    it('should normalize error with rate limit status', () => {
      const error = { message: 'Rate limit exceeded', status: 429 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.providerId).toBe('mistral');
      expect(normalized.message).toBe('Rate limit exceeded');
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
      expect(normalized.message).toBe('Mistral request failed');
    });
  });

  describe('generate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.generate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should call the Mistral chat completions endpoint', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: 'Hello' } }],
      }));

      const result = await runtime.generate({
        mode: 'chat-completions',
        requestOptions: {
          model: 'magistral-medium-2509',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mistral.ai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-mistral-key',
          }),
        }),
      );
      expect(result).toEqual({ choices: [{ message: { content: 'Hello' } }] });
    });
  });

  describe('streamGenerate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.streamGenerate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should return async iterable from Mistral stream', async () => {

      const events = [
        { data: { choices: [{ delta: { content: 'Hello' } }] } },
        { data: { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] } },
      ];

      mockFetch.mockResolvedValue(sseResponse(events));

      const iterable = await runtime.streamGenerate({
        mode: 'chat-completions',
        requestOptions: {
          model: 'magistral-medium-2509',
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
