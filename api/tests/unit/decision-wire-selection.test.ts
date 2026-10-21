import * as mesh from '@sentropic/llm-mesh';
import type { GenerateRequest, PlannedRouteTarget } from '@sentropic/llm-mesh';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callLLM, callLLMStream } from '../../src/services/llm-runtime';
import { applicationGatewayRuntime } from '../../src/services/llm-runtime/gateway-wire-adapter';

vi.mock('../../src/services/llm-runtime', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));

const subject = { principalRef: 'synthetic-user', ownerScopeRef: 'synthetic-owner' };
const request: GenerateRequest = { modelId: 'gpt-4.1-nano', messages: [{ role: 'user', content: 'synthetic' }] };
const target = (providerId: string): PlannedRouteTarget => ({
  providerId, modelId: 'gpt-4.1-nano', requestedModel: 'gpt-4.1-nano',
  transportProviderId: providerId, reason: 'exact',
});

beforeEach(() => {
  vi.clearAllMocks();
  const original = mesh.getProviderProfile;
  vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
    id === 'muse' ? { ...original(id), decisionOnly: true } : original(id)
  ));
});
afterEach(() => vi.restoreAllMocks());

describe('decision-only gateway wire selection', () => {
  it.each(['muse', 'typesafe', 'unknown-provider'])('refuses unsupported targets before either runtime call (%s)', async (providerId) => {
    const error = providerId === 'unknown-provider' ? 'unsupported provider' : 'Decision-only providers';
    await expect(applicationGatewayRuntime.generate(subject, undefined, target(providerId), request)).rejects.toThrow(error);
    await expect(applicationGatewayRuntime.stream(subject, undefined, target(providerId), request)).rejects.toThrow(error);
    expect(callLLM).not.toHaveBeenCalled();
    expect(callLLMStream).not.toHaveBeenCalled();
  });

  it.each(['openai', 'local'])('preserves ordinary generate and stream delegation (%s)', async (providerId) => {
    vi.mocked(callLLM).mockResolvedValue({
      id: 'synthetic-response', model: 'gpt-4.1-nano', object: 'chat.completion', created: 0,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok', refusal: null },
        finish_reason: 'stop', logprobs: null }],
    });
    vi.mocked(callLLMStream).mockImplementation(async function* () {
      yield { type: 'content_delta', data: { delta: 'ok' } };
      yield { type: 'done', data: {} };
    });
    expect(await applicationGatewayRuntime.generate(subject, undefined, target(providerId), request))
      .toMatchObject({ providerId, text: 'ok' });
    const events = [];
    for await (const event of await applicationGatewayRuntime.stream(subject, undefined, target(providerId), request)) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual(['content_delta', 'done']);
    expect(callLLM).toHaveBeenCalledWith(expect.objectContaining({ providerId }));
    expect(callLLMStream).toHaveBeenCalledWith(expect.objectContaining({ providerId }));
  });
});
