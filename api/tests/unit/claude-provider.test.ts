import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Anthropic SDK before importing the provider
const mockAnthropicCreate = vi.fn();
const mockAnthropicStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: mockAnthropicCreate,
      stream: mockAnthropicStream,
    };
  }
  return { default: MockAnthropic };
});

// Mock env to control API key presence
vi.mock('../../src/config/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  },
}));

import { ClaudeProviderRuntime } from '../../src/services/providers/claude-provider';

describe('ClaudeProviderRuntime', () => {
  let runtime: ClaudeProviderRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new ClaudeProviderRuntime();
  });

  describe('provider descriptor', () => {
    it('should have correct provider id and label', () => {
      expect(runtime.provider.providerId).toBe('anthropic');
      expect(runtime.provider.label).toBe('Anthropic Claude');
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
    it('should return Claude model catalog entries', () => {
      const models = runtime.listModels();
      expect(models).toHaveLength(2);

      const sonnet = models.find((m) => m.modelId === 'claude-sonnet-4-6');
      expect(sonnet).toBeDefined();
      expect(sonnet!.providerId).toBe('anthropic');
      expect(sonnet!.reasoningTier).toBe('standard');
      expect(sonnet!.supportsTools).toBe(true);
      expect(sonnet!.supportsStreaming).toBe(true);

      const opus = models.find((m) => m.modelId === 'claude-opus-4-7');
      expect(opus).toBeDefined();
      expect(opus!.reasoningTier).toBe('advanced');
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
      expect(result.message).toContain('Anthropic API key');
    });
  });

  describe('normalizeError', () => {
    it('should normalize error with message string', () => {
      const error = { message: 'Rate limit exceeded', status: 429 };
      const normalized = runtime.normalizeError(error);
      expect(normalized.providerId).toBe('anthropic');
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
      const error = new Error('SDK error');
      const normalized = runtime.normalizeError(error);
      expect(normalized.message).toBe('SDK error');
    });

    it('should provide fallback message for unknown errors', () => {
      const normalized = runtime.normalizeError(null);
      expect(normalized.message).toBe('Anthropic request failed');
    });
  });

  describe('generate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.generate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should call Anthropic messages.create with stream false', async () => {
      mockAnthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Hello' }] });

      const result = await runtime.generate({
        mode: 'messages',
        requestOptions: {
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        },
      });

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false }),
        expect.anything(),
      );
      expect(result).toEqual({ content: [{ type: 'text', text: 'Hello' }] });
    });
  });

  describe('streamGenerate', () => {
    it('should reject unsupported mode', async () => {
      await expect(
        runtime.streamGenerate({ mode: 'unsupported', requestOptions: {} }),
      ).rejects.toThrow('unsupported mode');
    });

    it('should return async iterable from Anthropic stream', async () => {

      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'message_stop' },
      ];

      mockAnthropicStream.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
        },
      });

      const iterable = await runtime.streamGenerate({
        mode: 'messages',
        requestOptions: {
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
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
