import { describe, expect, it } from 'vitest';

import { buildGeminiRequestBody } from '../../src/services/llm-runtime';

describe('buildGeminiRequestBody', () => {
  it('does not request Gemini thoughts when reasoning is not requested', () => {
    const body = buildGeminiRequestBody({
      model: 'gemini-3.1-pro-preview-customtools',
      messages: [{ role: 'user', content: 'Say OK' }],
    }) as Record<string, unknown>;

    expect(body).not.toHaveProperty('generationConfig.thinkingConfig');
  });

  it('requests Gemini thoughts when reasoning is requested', () => {
    const body = buildGeminiRequestBody({
      model: 'gemini-3.1-pro-preview-customtools',
      messages: [{ role: 'user', content: 'Analyze deeply' }],
      reasoningEffort: 'high',
    }) as {
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: number;
          includeThoughts: boolean;
        };
      };
    };

    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 8192,
      includeThoughts: true,
    });
  });

  it('preserves assistant history content without provider-specific rewriting', () => {
    const body = buildGeminiRequestBody({
      model: 'gemini-3.1-pro-preview-customtools',
      messages: [
        {
          role: 'assistant',
          content:
            '...94>thought CRITICAL INSTRUCTION 1: internal. CRITICAL INSTRUCTION 2: internal.OK',
        },
        { role: 'user', content: 'Continue' },
      ],
    }) as { contents: Array<Record<string, unknown>> };

    expect(body.contents).toEqual([
      {
        role: 'model',
        parts: [
          {
            text:
              '...94>thought CRITICAL INSTRUCTION 1: internal. CRITICAL INSTRUCTION 2: internal.OK',
          },
        ],
      },
      {
        role: 'user',
        parts: [{ text: 'Continue' }],
      },
    ]);
  });

  it('keeps textual fallback even when tool metadata is present', () => {
    const body = buildGeminiRequestBody({
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'Read the repo file' },
      ],
      rawInput: [
        {
          type: 'function_call_output',
          call_id: 'call_local_file_read_1',
          name: 'file_read',
          args: { path: 'README.md' },
          output: JSON.stringify({ status: 'completed', content: 'ok' }),
        },
      ],
    }) as {
      contents: Array<Record<string, unknown>>;
      systemInstruction: Record<string, unknown>;
    };

    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'SYS' }],
    });
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Read the repo file' }],
      },
      {
        role: 'user',
        parts: [
          {
            text:
              'Tool output (call_local_file_read_1): {"status":"completed","content":"ok"}',
          },
        ],
      },
    ]);
  });

  it('keeps textual fallback when function metadata is missing', () => {
    const body = buildGeminiRequestBody({
      messages: [{ role: 'user', content: 'Read the repo file' }],
      rawInput: [
        {
          type: 'function_call_output',
          call_id: 'call_local_file_read_1',
          output: '{"status":"completed"}',
        },
      ],
    }) as { contents: Array<Record<string, unknown>> };

    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Read the repo file' }],
      },
      {
        role: 'user',
        parts: [{ text: 'Tool output (call_local_file_read_1): {"status":"completed"}' }],
      },
    ]);
  });
});
