/**
 * Responses ingress codec (spec §16.3): strict stateless request
 * normalization with lossless canonical mapping. Failing cases throw
 * `ResponsesIngressError` carrying a safe field path (mapped to 400
 * `bad_request` / `unsupported_parameter` by the router).
 */
import { describe, expect, it } from 'vitest';

import {
  normalizeResponsesIngress,
  ResponsesIngressError,
} from '../src/responses-ingress.js';
import { DEFAULT_RESPONSES_LIMITS } from '../src/responses-egress.js';

const ingress = (body: unknown) => normalizeResponsesIngress(body);

const bad = (body: unknown): { fieldPath: string; errorCode: string } => {
  try {
    ingress(body);
  } catch (error) {
    expect(error).toBeInstanceOf(ResponsesIngressError);
    const failure = error as ResponsesIngressError;
    return { fieldPath: failure.fieldPath, errorCode: failure.errorCode };
  }
  throw new Error('Expected ResponsesIngressError');
};

const minimal = (extra: Record<string, unknown> = {}) => ({
  model: 'gpt-6.1-sol', input: 'hello', ...extra,
});

describe('responses ingress basics', () => {
  it('maps a string input to one user message', () => {
    const result = ingress(minimal());
    expect(result.request.model).toBe('gpt-6.1-sol');
    expect(result.request.messages).toEqual([
      { role: 'user', content: 'hello', metadata: { ingress: 'hello' } },
    ]);
    expect(result.requiredCapabilities).toEqual([]);
    expect(result.requiredExecutionFeatures).toEqual([]);
  });

  it('keeps a deliberately empty string input', () => {
    const result = ingress(minimal({ input: '' }));
    expect(result.request.messages).toEqual([
      { role: 'user', content: '', metadata: { ingress: '' } },
    ]);
  });

  it('prepends instructions as an instruction message', () => {
    const result = ingress(minimal({ instructions: 'Be brief.' }));
    expect(result.request.messages[0]).toMatchObject({ role: 'system', content: 'Be brief.' });
    expect(result.request.messages[1]).toMatchObject({ role: 'user' });
  });

  it('preserves ordered roles and maps input_text parts', () => {
    const result = ingress(minimal({
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'sys' }] },
        { role: 'user', content: 'hi' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'yo' }] },
      ],
    }));
    expect(result.request.messages.map((message) => message.role))
      .toEqual(['developer', 'user', 'assistant']);
    expect(result.request.messages[0]).toMatchObject({ content: [{ type: 'text', text: 'sys' }] });
    expect(result.request.messages[2]).toMatchObject({ content: [{ type: 'text', text: 'yo' }] });
  });

  it('rejects a missing model, non-string input and unknown roles', () => {
    expect(bad({ input: 'hi' })).toMatchObject({ fieldPath: 'model', errorCode: 'bad_request' });
    expect(bad(minimal({ input: 42 }))).toMatchObject({ fieldPath: 'input', errorCode: 'bad_request' });
    expect(bad(minimal({ input: [{ role: 'wizard', content: 'hi' }] })))
      .toMatchObject({ fieldPath: 'input[0].role', errorCode: 'bad_request' });
    expect(bad(minimal({ instructions: 7 }))).toMatchObject({ fieldPath: 'instructions' });
  });

  it('rejects unknown top-level fields explicitly', () => {
    expect(bad(minimal({ future_flag: true })))
      .toMatchObject({ fieldPath: 'future_flag', errorCode: 'unsupported_parameter' });
  });
});

describe('responses ingress tools', () => {
  const functionTool = {
    type: 'function', name: 'get_time',
    description: 'Current time',
    parameters: { type: 'object', properties: {} },
  };

  it('maps flat function tools to canonical definitions', () => {
    const result = ingress(minimal({ tools: [functionTool] }));
    expect(result.request.tools).toEqual([{
      type: 'function', name: 'get_time', description: 'Current time',
      inputSchema: { type: 'object', properties: {} },
      providerMetadata: { ingress: functionTool },
    }]);
    expect(result.requiredCapabilities).toContain('tools');
  });

  it('registers namespaced function tools under their bare names', () => {
    const result = ingress(minimal({
      tools: [{ type: 'namespace', name: 'muse', tools: [functionTool] }],
    }));
    expect(result.request.tools?.map((tool) => tool.name)).toEqual(['get_time']);
    expect(result.requiredCapabilities).toContain('tools');
  });

  it('rejects duplicate bare tool names across namespaces', () => {
    expect(bad(minimal({
      tools: [
        { type: 'namespace', name: 'muse', tools: [functionTool] },
        { type: 'namespace', name: 'other', tools: [functionTool] },
      ],
    }))).toMatchObject({ fieldPath: 'tools[1].tools[0].name', errorCode: 'bad_request' });
  });

  it('joins function_call history to its call_id, keeping item id separate', () => {
    const result = ingress(minimal({
      tools: [functionTool],
      input: [
        { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'get_time', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call-1', output: 'noon' },
      ],
    }));
    const [call, output] = result.request.messages;
    expect(call).toMatchObject({
      role: 'assistant',
      toolCalls: [{ toolCallId: 'call-1', providerCallId: 'call-1', name: 'get_time', argumentsText: '{}' }],
    });
    expect(output).toMatchObject({
      role: 'tool',
      toolResult: expect.objectContaining({ toolCallId: 'call-1', providerCallId: 'call-1', name: 'get_time' }),
    });
    // The item id is identity metadata, never the correlation key.
    expect(JSON.stringify(call)).not.toContain('"toolCallId":"item-1"');
  });

  it('matches dotted call names to qualified definitions', () => {
    const result = ingress(minimal({
      tools: [{ type: 'namespace', name: 'muse', tools: [functionTool] }],
      input: [
        { type: 'function_call', id: 'i', call_id: 'c', name: 'muse.get_time', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c', output: 'noon' },
      ],
    }));
    expect(result.request.messages[0]).toMatchObject({
      toolCalls: [{ name: 'get_time' }],
    });
  });

  it('rejects orphan outputs, duplicate calls and unknown names', () => {
    expect(bad(minimal({
      tools: [functionTool],
      input: [{ type: 'function_call_output', call_id: 'ghost', output: 'x' }],
    }))).toMatchObject({ fieldPath: 'input[0].call_id' });
    const call = { type: 'function_call', id: 'i', call_id: 'c', name: 'get_time', arguments: '{}' };
    expect(bad(minimal({ tools: [functionTool], input: [call, { ...call, id: 'i2' }] })))
      .toMatchObject({ fieldPath: 'input[1].call_id' });
    expect(bad(minimal({
      tools: [functionTool],
      input: [{ type: 'function_call', id: 'i', call_id: 'c', name: 'nope', arguments: '{}' }],
    }))).toMatchObject({ fieldPath: 'input[0].name', errorCode: 'unsupported_parameter' });
  });

  it('preserves explicit false values (parallel off, no truncation change)', () => {
    const result = ingress(minimal({ tool_choice: 'auto', parallel_tool_calls: false }));
    expect(result.request.parallelToolCalls).toBe(false);
    expect(result.requiredExecutionFeatures).toContain('parallel-tool-control');
  });

  it('maps a named tool choice and rejects unknown names', () => {
    const result = ingress(minimal({
      tools: [functionTool], tool_choice: { type: 'function', name: 'get_time' },
    }));
    expect(result.request.toolChoice).toEqual({ type: 'tool', name: 'get_time' });
    expect(result.requiredExecutionFeatures).toContain('named-tool-choice');
    expect(bad(minimal({
      tools: [functionTool], tool_choice: { type: 'function', name: 'ghost' },
    }))).toMatchObject({ fieldPath: 'tool_choice.name' });
  });

  it('carries custom tools opaquely for native execution only', () => {
    const result = ingress(minimal({
      tools: [{ type: 'custom', name: 'exec', description: 'Run code', format: 'js' }],
    }));
    expect(result.request.tools ?? []).toEqual([]);
    expect(result.requiredExecutionFeatures).toContain('custom-tools');
  });
});

describe('responses ingress media, formats and controls', () => {
  it('preserves image inputs with detail and derives the image capability', () => {
    const result = ingress(minimal({
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://x/y.png', detail: 'low' }] }],
    }));
    expect(result.request.messages[0]).toMatchObject({
      content: [{ type: 'image', url: 'https://x/y.png' }],
    });
    expect(result.requiredCapabilities).toContain('input:image');
    expect(bad(minimal({
      input: [{ role: 'user', content: [{ type: 'input_image', file_id: 'f1' }] }],
    }))).toMatchObject({ errorCode: 'unsupported_parameter' });
  });

  it('maps text formats and strict schemas to features', () => {
    const schema = ingress(minimal({
      text: { format: { type: 'json_schema', name: 'r', schema: { type: 'object' }, strict: true } },
    }));
    expect(schema.request.responseFormat).toEqual({
      type: 'json-schema', name: 'r', schema: { type: 'object' }, strict: true,
    });
    expect(schema.requiredExecutionFeatures).toEqual(
      expect.arrayContaining(['structured-output', 'strict-schema']),
    );
    const plain = ingress(minimal({ text: { format: { type: 'text' } } }));
    expect(plain.requiredExecutionFeatures).not.toContain('structured-output');
  });

  it('maps reasoning effort/summary and native-only context/verbosity', () => {
    const result = ingress(minimal({
      reasoning: { effort: 'max', summary: 'auto' }, text: { verbosity: 'low' },
    }));
    expect(result.request.reasoning).toEqual({ effort: 'max', summary: 'auto' });
    expect(result.requiredExecutionFeatures).toEqual(
      expect.arrayContaining(['reasoning-controls', 'verbosity']),
    );
    expect(result.requiredCapabilities).toContain('reasoning');
    expect(bad(minimal({ reasoning: { effort: 'ultra' } })))
      .toMatchObject({ fieldPath: 'reasoning.effort' });
    const withContext = ingress(minimal({ reasoning: { effort: 'low', context: 'all_turns' } }));
    expect(withContext.requiredExecutionFeatures).toContain('reasoning-context');
  });

  it('keeps an explicit output ceiling and refuses invalid ceilings', () => {
    const result = ingress(minimal({ max_output_tokens: 128000 }));
    expect(result.request.maxOutputTokens).toBe(128000);
    expect(result.requiredExecutionFeatures).toContain('explicit-output-ceiling');
    expect(bad(minimal({ max_output_tokens: 0 })))
      .toMatchObject({ fieldPath: 'max_output_tokens' });
    expect(bad(minimal({ max_output_tokens: 1.5 })))
      .toMatchObject({ fieldPath: 'max_output_tokens' });
  });

  it('refuses stateful and hosted behavior before acquisition', () => {
    expect(bad(minimal({ store: true }))).toMatchObject({ fieldPath: 'store' });
    expect(bad(minimal({ background: true }))).toMatchObject({ fieldPath: 'background' });
    expect(bad(minimal({ truncation: 'auto' }))).toMatchObject({ fieldPath: 'truncation' });
    expect(bad(minimal({ previous_response_id: 'resp_1' })))
      .toMatchObject({ fieldPath: 'previous_response_id' });
    expect(bad(minimal({ conversation: {} }))).toMatchObject({ fieldPath: 'conversation' });
    expect(bad(minimal({ include: ['web_search'] })))
      .toMatchObject({ errorCode: 'unsupported_parameter' });
    const encrypted = ingress(minimal({ include: ['reasoning.encrypted_content'] }));
    expect(encrypted.requiredExecutionFeatures).not.toContain('native-reasoning-replay');
  });

  it('bounds request metadata and telemetry without routing on them', () => {
    const result = ingress(minimal({
      metadata: { run: 'a' }, prompt_cache_key: 'k', safety_identifier: 's',
      client_metadata: { root_turn_id: 't' },
    }));
    expect(result.requiredExecutionFeatures).toEqual([]);
    expect(bad(minimal({ metadata: 'nope' }))).toMatchObject({ fieldPath: 'metadata' });
    expect(bad(minimal({ client_metadata: [1] }))).toMatchObject({ fieldPath: 'client_metadata' });
  });
});

describe('responses ingress bounds (spec §16.7)', () => {
  const tool = (name: string) => ({ type: 'function', name, parameters: { type: 'object' } });

  it('rejects input arrays beyond maxInputItems', () => {
    const items = Array.from({ length: 4097 }, (_, index) => ({ role: 'user', content: `m${index}` }));
    expect(bad(minimal({ input: items }))).toMatchObject({ fieldPath: 'input', errorCode: 'bad_request' });
  });

  it('accepts an input array at exactly maxInputItems', () => {
    const items = Array.from({ length: 4096 }, (_, index) => ({ role: 'user', content: `m${index}` }));
    expect(() => ingress(minimal({ input: items }))).not.toThrow();
  });

  it('rejects tool lists beyond maxTools', () => {
    const tools = Array.from({ length: 257 }, (_, index) => tool(`t${index}`));
    expect(bad(minimal({ input: 'hi', tools }))).toMatchObject({ fieldPath: 'tools', errorCode: 'bad_request' });
  });

  it('honors tighter host bounds passed with the body', () => {
    const body = minimal({ input: 'hi', tools: [tool('a'), tool('b')] });
    const limits = { ...DEFAULT_RESPONSES_LIMITS, maxTools: 1 };
    try {
      normalizeResponsesIngress(body, limits);
    } catch (error) {
      expect(error).toBeInstanceOf(ResponsesIngressError);
      expect((error as ResponsesIngressError).fieldPath).toBe('tools');
      return;
    }
    throw new Error('Expected ResponsesIngressError');
  });
});


