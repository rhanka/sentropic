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
    expect(normalized.request.providerOptions?.ingressBody).toBe(body);
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
});
