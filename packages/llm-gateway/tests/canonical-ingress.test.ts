import { describe, expect, it } from 'vitest';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';

describe('canonical gateway ingress', () => {
  it('preserves Anthropic system, image, tools and the original body', () => {
    const body = {
      model: 'claude-opus-5-high',
      system: [{ type: 'text', text: 'Keep every block.' }],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } },
        ],
      }],
      tools: [{ name: 'lookup', description: 'Lookup data', input_schema: { type: 'object' } }],
      thinking: { type: 'enabled', budget_tokens: 1024 },
      tool_choice: { type: 'tool', name: 'lookup', disable_parallel_tool_use: true },
      max_tokens: 2048,
      stream: true,
    };

    const normalized = normalizeGatewayIngress('anthropic-messages', body);

    expect(normalized.requiredCapabilities).toEqual([
      'tools', 'input:image', 'reasoning', 'streaming',
    ]);
    expect(normalized.request.messages[0]).toMatchObject({
      role: 'system', content: [{ type: 'text', text: 'Keep every block.' }],
    });
    expect(normalized.request.messages[1]).toMatchObject({
      role: 'user', content: [
        { type: 'text', text: 'Inspect this.' },
        { type: 'image', mediaType: 'image/png', data: 'AA==' },
      ],
    });
    expect(normalized.request.tools?.[0]).toMatchObject({ name: 'lookup' });
    expect(normalized.request).toMatchObject({
      toolChoice: { type: 'tool', name: 'lookup' },
      parallelToolCalls: false,
      reasoning: { enabled: true, budgetTokens: 1024 },
    });
    expect(normalized.request.providerOptions?.ingressBody).toBe(body);
  });

  it('preserves signed Anthropic thinking history as a distinct canonical part', () => {
    const normalized = normalizeGatewayIngress('anthropic-messages', {
      model: 'gemini-3.1-flash-lite',
      messages: [{ role: 'assistant', content: [
        { type: 'thinking', thinking: 'private chain', signature: 'signed-history' },
        { type: 'text', text: 'visible answer' },
      ] }],
    });
    expect(normalized.request.messages[0]).toMatchObject({
      role: 'assistant', content: [
        { type: 'reasoning', text: 'private chain', signature: 'signed-history' },
        { type: 'text', text: 'visible answer' },
      ],
    });
  });

  it('preserves OpenAI tool calls and tool results', () => {
    const body = {
      model: 'gpt-5.6-terra',
      messages: [{
        role: 'assistant', content: '',
        tool_calls: [{
          id: 'call_1', type: 'function',
          function: { name: 'lookup', arguments: '{"id":1}' },
        }],
      }, {
        role: 'tool', tool_call_id: 'call_1', content: '{"value":42}',
      }],
      tools: [{
        type: 'function',
        function: { name: 'lookup', parameters: { type: 'object' } },
      }],
    };

    const normalized = normalizeGatewayIngress('openai-chat-completions', body);

    expect(normalized.request.messages[0]).toMatchObject({
      role: 'assistant', toolCalls: [{
        toolCallId: 'call_1', name: 'lookup', argumentsText: '{"id":1}',
      }],
    });
    expect(normalized.request.messages[1]).toMatchObject({
      role: 'tool', toolResult: {
        toolCallId: 'call_1', providerCallId: 'call_1', output: '{"value":42}',
      },
    });
    expect(normalized.requiredCapabilities).toEqual(['tools']);
  });

  it('preserves Anthropic tool use and result continuation without leaking blocks as text', () => {
    const body = {
      model: 'gemini-3.1-flash-lite',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect it.' },
          { type: 'thinking', thinking: '', signature: 'cloud-signature' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'sleep 3' } },
        ],
      }, {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'completed' },
          { type: 'text', text: 'Continue after the tool.' },
        ],
      }],
      tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
    };

    const normalized = normalizeGatewayIngress('anthropic-messages', body);

    expect(normalized.request.messages).toHaveLength(3);
    expect(normalized.request.messages[0]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will inspect it.' },
        { type: 'reasoning', text: '', signature: 'cloud-signature' },
      ],
      toolCalls: [{
        toolCallId: 'toolu_1', providerCallId: 'toolu_1', name: 'Bash',
        argumentsText: '{"command":"sleep 3"}', arguments: { command: 'sleep 3' },
        metadata: { thoughtSignature: 'cloud-signature' },
      }],
    });
    expect(normalized.request.messages[1]).toMatchObject({
      role: 'tool', content: 'completed',
      toolResult: {
        toolCallId: 'toolu_1', providerCallId: 'toolu_1', name: 'Bash',
        output: { content: 'completed' },
        content: [{ type: 'text', text: 'completed' }],
      },
    });
    expect(normalized.request.messages[2]).toMatchObject({
      role: 'user', content: [{ type: 'text', text: 'Continue after the tool.' }],
    });
    expect(JSON.stringify(normalized.request.messages[0]?.content)).not.toContain('tool_use');
    expect(JSON.stringify(normalized.request.messages[1]?.content)).not.toContain('tool_result');
    expect(normalized.requiredCapabilities).toEqual(['tools']);
  });

  it('preserves Anthropic tool errors and rich result content', () => {
    const normalized = normalizeGatewayIngress('anthropic-messages', {
      model: 'gemini-3.1-flash-lite',
      messages: [{
        role: 'assistant', content: [
          { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/missing' } },
        ],
      }, {
        role: 'user', content: [{
          type: 'tool_result', tool_use_id: 'toolu_2', is_error: true,
          content: [{ type: 'text', text: 'not found' }],
        }],
      }],
    });

    expect(normalized.request.messages).toHaveLength(2);
    expect(normalized.request.messages[1]).toMatchObject({
      role: 'tool',
      toolResult: {
        name: 'Read', output: { content: 'not found' }, isError: true,
        error: { type: 'tool_error', message: 'not found', retryable: false },
      },
    });
  });
});
