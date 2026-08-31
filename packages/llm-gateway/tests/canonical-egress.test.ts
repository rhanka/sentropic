import { describe, expect, it } from 'vitest';
import { encodeGatewayResponse } from '../src/canonical-egress.js';

const response = {
  id: 'response-1', providerId: 'openai' as const, modelId: 'gpt-5.6-terra' as const,
  message: { role: 'assistant' as const, content: 'Done.' }, text: 'Done.',
  toolCalls: [{
    toolCallId: 'sentropic-call-1', providerCallId: 'provider-call-1',
    name: 'lookup', argumentsText: '{"id":1}', arguments: { id: 1 },
    metadata: { thoughtSignature: 'cloud-signature' },
  }],
  finishReason: 'tool_calls' as const,
  usage: { inputTokens: 12, outputTokens: 7, reasoningTokens: 3, totalTokens: 19 },
  providerMetadata: {
    responseHeaders: { 'retry-after': '4', 'x-request-id': 'provider-request-1' },
  },
};

describe('canonical gateway egress', () => {
  it('encodes an Anthropic message without flattening tool calls', () => {
    const encoded = encodeGatewayResponse('anthropic-messages', response);

    expect(encoded.status).toBe(200);
    expect(encoded.body).toMatchObject({
      id: 'response-1', type: 'message', model: 'gpt-5.6-terra',
      content: [
        { type: 'text', text: 'Done.' },
        { type: 'thinking', thinking: '', signature: 'cloud-signature' },
        { type: 'tool_use', id: 'provider-call-1', name: 'lookup', input: { id: 1 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    expect(encoded.headers).toEqual({
      'retry-after': '4', 'x-request-id': 'provider-request-1',
    });
  });

  it('encodes an OpenAI completion with native usage and finish reason', () => {
    const encoded = encodeGatewayResponse('openai-chat-completions', response);

    expect(encoded.body).toMatchObject({
      id: 'response-1', object: 'chat.completion', model: 'gpt-5.6-terra',
      choices: [{
        message: {
          role: 'assistant', content: 'Done.',
          tool_calls: [{
            id: 'provider-call-1', type: 'function',
            function: { name: 'lookup', arguments: '{"id":1}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {
        prompt_tokens: 12, completion_tokens: 7, total_tokens: 19,
        reasoning_tokens: 3,
      },
    });
    expect(JSON.stringify(encoded)).not.toContain('ownerScopeRef');
  });
});
