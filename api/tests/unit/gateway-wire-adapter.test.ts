/** Gateway wire adapter (spec §16.4): preserve-or-refuse, no dispatch on refusal. No network, no DB. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GenerateRequest,
  PlannedRouteTarget,
  VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';

const { callLLM, callLLMStream } = vi.hoisted(() => ({
  callLLM: vi.fn(),
  callLLMStream: vi.fn(),
}));

vi.mock('../../src/services/llm-runtime/index', () => ({
  callLLM,
  callLLMStream,
}));

import { applicationGatewayRuntime } from '../../src/services/llm-runtime/gateway-wire-adapter';

const SUBJECT: VerifiedRoutingSubject = { principalRef: 'user-1', ownerScopeRef: 'owner-1' };

const targetFor = (providerId: string): PlannedRouteTarget => ({
  requestedModel: 'mistral-vibe-cli-latest',
  providerId,
  modelId: 'mistral-medium-3.5',
  transportProviderId: 'application-runtime',
  reason: 'exact',
});

const baseRequest = (extra: Partial<GenerateRequest> = {}): GenerateRequest => ({
  providerId: 'mistral',
  modelId: 'mistral-medium-3.5',
  messages: [{ role: 'user', content: 'hello' }],
  ...extra,
});

const chatResponse = () => ({
  id: 'chatcmpl-1',
  choices: [{ message: { content: 'hi',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{}' } }] },
    finish_reason: 'tool_calls' }],
  usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
});

async function* sourceEvents(events: Array<{ type: string; data: unknown }>) {
  for (const event of events) yield event;
}

describe('gateway wire adapter', () => {
  beforeEach(() => {
    callLLM.mockReset();
    callLLMStream.mockReset();
  });

  it('forwards supported chat controls and preserves tool calls, finish and usage', async () => {
    callLLM.mockResolvedValue(chatResponse());
    const response = await applicationGatewayRuntime.generate(
      SUBJECT, 'ws-1', targetFor('mistral'),
      baseRequest({
        tools: [{ type: 'function', name: 'get_time', inputSchema: { type: 'object' } }],
        toolChoice: 'auto',
      }),
    );
    expect(callLLM).toHaveBeenCalledOnce();
    expect(callLLM.mock.calls[0]?.[0]).toMatchObject({ toolChoice: 'auto', model: 'mistral-medium-3.5' });
    expect(response.toolCalls).toEqual([{
      toolCallId: 'call_1', providerCallId: 'call_1', name: 'get_time', argumentsText: '{}',
    }]);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.usage).toMatchObject({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  });

  it('refuses a named tool choice without provider dispatch', async () => {
    await expect(applicationGatewayRuntime.generate(
      SUBJECT, 'ws-1', targetFor('mistral'),
      baseRequest({ toolChoice: { type: 'tool', name: 'get_time' } }),
    )).rejects.toMatchObject({ status: 400, code: 'unsupported_projection' });
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('refuses parallel control without provider dispatch', async () => {
    await expect(applicationGatewayRuntime.generate(
      SUBJECT, 'ws-1', targetFor('mistral'),
      baseRequest({ parallelToolCalls: false }),
    )).rejects.toMatchObject({ status: 400, code: 'unsupported_projection' });
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('refuses reasoning controls on the generate path without dispatch', async () => {
    await expect(applicationGatewayRuntime.generate(
      SUBJECT, 'ws-1', targetFor('openai'),
      baseRequest({ reasoning: { effort: 'high' } }),
    )).rejects.toMatchObject({ status: 400, code: 'unsupported_projection' });
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('refuses selected mapping effort instead of dropping it at product dispatch', async () => {
    await expect(applicationGatewayRuntime.generate(SUBJECT, 'ws-1', {
      requestedModel: 'claude-opus-5-5', providerId: 'gemini', modelId: 'gemini-4-argon', transportProviderId: 'application-runtime', reason: 'alias', effort: 'high',
    }, baseRequest({ providerId: 'gemini', modelId: 'gemini-4-argon', reasoning: { effort: 'high' } })))
      .rejects.toMatchObject({ status: 400, code: 'unsupported_projection' });
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('forwards reasoning on stream and preserves the tool_calls terminal', async () => {
    callLLMStream.mockReturnValue(sourceEvents([
      { type: 'status', data: { state: 'started' } },
      { type: 'tool_call_start', data: { tool_call_id: 'call_9', name: 'get_time', args: '' } },
      { type: 'tool_call_delta', data: { tool_call_id: 'call_9', delta: '{"x":1}' } },
      { type: 'done', data: { usage: { input_tokens: 4, completion_tokens: 2, total_tokens: 6 } } },
    ]));
    const stream = await applicationGatewayRuntime.stream(
      SUBJECT, 'ws-1', targetFor('openai'),
      { ...baseRequest(), reasoning: { effort: 'high', summary: 'concise' } },
    );
    const events = [];
    for await (const event of stream) events.push(event);
    expect(callLLMStream).toHaveBeenCalledOnce();
    expect(callLLMStream.mock.calls[0]?.[0]).toMatchObject({
      reasoningEffort: 'high', reasoningSummary: 'concise',
    });
    const done = events[events.length - 1];
    expect(done).toMatchObject({
      type: 'done',
      data: { finishReason: 'tool_calls', usage: { totalTokens: 6 } },
    });
  });

  it('keeps a plain text stream terminal at stop', async () => {
    callLLMStream.mockReturnValue(sourceEvents([
      { type: 'status', data: { state: 'started' } },
      { type: 'content_delta', data: { delta: 'hi' } },
      { type: 'done', data: {} },
    ]));
    const stream = await applicationGatewayRuntime.stream(
      SUBJECT, 'ws-1', targetFor('mistral'), baseRequest(),
    );
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', data: { finishReason: 'stop' } });
  });

  it('refuses named choice and parallel control on stream without dispatch', async () => {
    await expect(applicationGatewayRuntime.stream(
      SUBJECT, 'ws-1', targetFor('mistral'),
      baseRequest({ toolChoice: { type: 'tool', name: 'get_time' } }),
    )).rejects.toMatchObject({ status: 400, code: 'unsupported_projection' });
    await expect(applicationGatewayRuntime.stream(
      SUBJECT, 'ws-1', targetFor('mistral'),
      baseRequest({ parallelToolCalls: true }),
    )).rejects.toMatchObject({ status: 400, code: 'unsupported_projection' });
    expect(callLLMStream).not.toHaveBeenCalled();
  });
});
