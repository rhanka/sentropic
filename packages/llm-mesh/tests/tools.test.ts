import { describe, expect, it } from 'vitest';

import type { ToolCall, ToolCallDelta, ToolResult } from '../src/tools.js';
import type { StreamEvent } from '../src/streaming.js';

describe('tool lifecycle payloads', () => {
  it('keeps streamed input lifecycle and dual call identifiers', () => {
    const call: ToolCall = {
      toolCallId: 'tool_123',
      sentropicCallId: 'mesh_call_123',
      providerCallId: 'provider_call_123',
      name: 'search_web',
      argumentsText: '{"query":"graph clusters"}',
      inputState: 'available',
      annotations: {
        title: 'Search the web',
        audience: 'assistant',
      },
    };

    const delta: ToolCallDelta = {
      toolCallId: 'tool_123',
      sentropicCallId: 'mesh_call_123',
      providerCallId: 'provider_call_123',
      delta: '"clusters"}',
      accumulatedArgumentsText: '{"query":"graph clusters"}',
      inputState: 'complete',
    };

    expect(call.inputState).toBe('available');
    expect(delta.inputState).toBe('complete');
    expect(delta.providerCallId).toBe('provider_call_123');
  });

  it('supports rich tool results with continuation metadata', () => {
    const result: ToolResult = {
      toolCallId: 'tool_123',
      sentropicCallId: 'mesh_call_123',
      providerCallId: 'provider_call_123',
      name: 'search_web',
      output: { ok: true },
      content: [
        { type: 'text', text: '3 results' },
        { type: 'json', value: { total: 3 } },
        {
          type: 'resource',
          uri: 'https://example.com/report',
          title: 'Search report',
        },
      ],
      continuation: {
        state: 'submitted',
        sentropicResponseId: 'resp_mesh_123',
        providerResponseId: 'resp_provider_123',
      },
      annotations: {
        sensitivity: 'internal',
        cacheability: 'ephemeral',
      },
    };

    const event: StreamEvent = {
      type: 'tool_call_result',
      data: result,
    };

    expect(event.type).toBe('tool_call_result');
    expect(result.content?.map((entry) => entry.type)).toEqual(['text', 'json', 'resource']);
    expect(result.continuation?.providerResponseId).toBe('resp_provider_123');
  });
});
