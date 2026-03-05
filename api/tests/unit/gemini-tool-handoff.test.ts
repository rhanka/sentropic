import { describe, expect, it } from 'vitest';

import { buildGeminiRequestBody } from '../../src/services/llm-runtime';

describe('buildGeminiRequestBody', () => {
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
