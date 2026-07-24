import { describe, expect, it } from 'vitest';

import {
  mergeStreamUsage,
  normalizeProviderUsage,
  toMeshTokenUsage,
} from '../../src/services/llm-metering/usage-normalizer';

describe('normalizeProviderUsage', () => {
  it('normalizes the OpenAI chat-completions and Mistral shape', () => {
    expect(
      normalizeProviderUsage({
        usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 },
      }),
    ).toEqual({
      inputTokens: 12,
      outputTokens: 30,
      totalTokens: 42,
      providerRawUsage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 },
    });
  });

  it('normalizes the OpenAI responses shape including reasoning tokens', () => {
    const usage = {
      input_tokens: 5,
      output_tokens: 7,
      total_tokens: 12,
      output_tokens_details: { reasoning_tokens: 3 },
    };

    expect(normalizeProviderUsage({ usage })).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      reasoningTokens: 3,
      totalTokens: 12,
      providerRawUsage: usage,
    });
  });

  it('normalizes the Anthropic shape and derives the missing total', () => {
    expect(normalizeProviderUsage({ usage: { input_tokens: 4, output_tokens: 6 } })).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
      providerRawUsage: { input_tokens: 4, output_tokens: 6 },
    });
  });

  it('normalizes the Gemini/GCP usageMetadata shape', () => {
    const usageMetadata = {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 128,
      thoughtsTokenCount: 8,
    };

    expect(normalizeProviderUsage({ usageMetadata })).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 8,
      totalTokens: 128,
      providerRawUsage: usageMetadata,
    });
  });

  it('normalizes the nested Cohere v2 token shape', () => {
    expect(
      normalizeProviderUsage({ usage: { tokens: { input_tokens: 9, output_tokens: 11 } } }),
    ).toEqual({
      inputTokens: 9,
      outputTokens: 11,
      totalTokens: 20,
      providerRawUsage: { input_tokens: 9, output_tokens: 11 },
    });
  });

  it('preserves a reported zero instead of treating it as missing', () => {
    expect(normalizeProviderUsage({ usage: { prompt_tokens: 0, completion_tokens: 0 } })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      providerRawUsage: { prompt_tokens: 0, completion_tokens: 0 },
    });
  });

  it('returns undefined when the payload carries no usable counter', () => {
    expect(normalizeProviderUsage(undefined)).toBeUndefined();
    expect(normalizeProviderUsage(null)).toBeUndefined();
    expect(normalizeProviderUsage('done')).toBeUndefined();
    expect(normalizeProviderUsage({})).toBeUndefined();
    expect(normalizeProviderUsage({ usage: {} })).toBeUndefined();
    expect(normalizeProviderUsage({ usage: { prompt_tokens: 'many' } })).toBeUndefined();
  });
});

describe('mergeStreamUsage', () => {
  it('carries counters forward across a split Anthropic stream', () => {
    let usage = mergeStreamUsage(undefined, {
      type: 'message_start',
      message: { usage: { input_tokens: 40 } },
    });
    usage = mergeStreamUsage(usage, { type: 'content_block_delta' });
    usage = mergeStreamUsage(usage, { type: 'message_delta', usage: { output_tokens: 9 } });

    expect(usage).toMatchObject({ inputTokens: 40, outputTokens: 9 });
  });

  it('lets a later chunk overwrite an earlier growing Gemini counter', () => {
    let usage = mergeStreamUsage(undefined, {
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    });
    usage = mergeStreamUsage(usage, {
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 25, totalTokenCount: 35 },
    });

    expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 25, totalTokens: 35 });
  });

  it('stays undefined when no chunk ever reports usage', () => {
    let usage: ReturnType<typeof mergeStreamUsage>;
    usage = mergeStreamUsage(undefined, { type: 'content_delta', delta: 'hi' });
    usage = mergeStreamUsage(usage, { type: 'message-end' });

    expect(usage).toBeUndefined();
  });
});

describe('toMeshTokenUsage', () => {
  it('passes an already-normalized value through untouched', () => {
    const normalized = { inputTokens: 3, outputTokens: 4, totalTokens: 7 };
    expect(toMeshTokenUsage(normalized)).toBe(normalized);
  });

  it('normalizes the raw OpenAI-responses payload forwarded by the runtime', () => {
    expect(toMeshTokenUsage({ input_tokens: 11, output_tokens: 7, total_tokens: 18 })).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
  });

  it('returns undefined for a missing or unusable payload', () => {
    expect(toMeshTokenUsage(undefined)).toBeUndefined();
    expect(toMeshTokenUsage({})).toBeUndefined();
  });
});
