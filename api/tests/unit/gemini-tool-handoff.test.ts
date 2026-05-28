import { describe, expect, it } from 'vitest';

import { buildGeminiRequestBody } from '../../src/services/llm-runtime';

describe('buildGeminiRequestBody', () => {
  it('does not request Gemini thoughts when reasoning is not requested', () => {
    const body = buildGeminiRequestBody({
      model: 'gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'Say OK' }],
    }) as Record<string, unknown>;

    expect(body).not.toHaveProperty('generationConfig.thinkingConfig');
  });

  it('requests Gemini thoughts when reasoning is requested', () => {
    const body = buildGeminiRequestBody({
      model: 'gemini-3.1-flash-lite',
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
      model: 'gemini-3.1-flash-lite',
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

  it('strips Gemini-unsupported JSON Schema keywords from tool parameter declarations', () => {
    const body = buildGeminiRequestBody({
      model: 'gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'Use the tool' }],
      toolChoice: 'auto',
      tools: [
        {
          type: 'function',
          function: {
            name: 'update_initiative_field',
            description: 'Update an initiative field',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string' },
                value: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { nested: { type: 'string' } },
                },
              },
              required: ['field', 'value'],
            },
          },
        },
      ],
    }) as {
      tools: Array<{
        functionDeclarations: Array<{ parameters: Record<string, unknown> }>;
      }>;
    };

    const params = body.tools[0].functionDeclarations[0].parameters;
    // Unsupported keyword stripped at every level (Gemini rejects it).
    expect(params).not.toHaveProperty('additionalProperties');
    const valueSchema = (params.properties as Record<string, Record<string, unknown>>).value;
    expect(valueSchema).not.toHaveProperty('additionalProperties');
    // Supported structure preserved.
    expect((valueSchema.properties as Record<string, unknown>).nested).toEqual({ type: 'string' });
    expect(params.required).toEqual(['field', 'value']);
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
