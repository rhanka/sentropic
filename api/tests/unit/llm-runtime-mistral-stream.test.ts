import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all external dependencies to isolate stream normalization logic
vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({
      defaultProviderId: 'mistral',
      defaultModel: 'magistral-medium-2509',
      concurrency: 1,
      publishingConcurrency: 1,
      processingInterval: 1000,
    }),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'mistral',
    credential: 'test-key',
    source: 'environment',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    MISTRAL_API_KEY: 'test-mistral-key',
    OPENAI_API_KEY: 'test-openai-key',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    COHERE_API_KEY: '',
  },
}));

vi.mock('@mistralai/mistralai', () => {
  return {
    Mistral: vi.fn().mockImplementation(() => ({
      chat: {
        complete: vi.fn(),
        stream: vi.fn(),
      },
    })),
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn() },
  })),
}));

vi.mock('cohere-ai', () => ({
  CohereClient: vi.fn().mockImplementation(() => ({
    v2: { chat: vi.fn(), chatStream: vi.fn() },
  })),
}));

import type { StreamEvent } from '../../src/services/llm-runtime';

async function collectStreamEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('Mistral stream event normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should normalize content delta from OpenAI-compatible format', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('mistral');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'Hello' } }] } };
        yield { data: { choices: [{ delta: { content: ' world' } }] } };
        yield { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'mistral',
        model: 'magistral-medium-2509',
      }),
    );

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(2);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('Hello');
    expect((contentDeltas[1].data as { delta: string }).delta).toBe(' world');

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('should normalize tool calls from OpenAI-compatible format', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('mistral');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          data: {
            choices: [{
              delta: {
                tool_calls: [{
                  id: 'call_1',
                  index: 0,
                  function: { name: 'search', arguments: '{"q":' },
                }],
              },
            }],
          },
        };
        yield {
          data: {
            choices: [{
              delta: {
                tool_calls: [{
                  id: 'call_1',
                  index: 0,
                  function: { arguments: '"test"}' },
                }],
              },
            }],
          },
        };
        yield { data: { choices: [{ delta: {}, finish_reason: 'tool_calls' }] } };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Search something' }],
        providerId: 'mistral',
        model: 'magistral-medium-2509',
      }),
    );

    const toolStarts = events.filter((e) => e.type === 'tool_call_start');
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0].data as { name: string }).name).toBe('search');
    expect((toolStarts[0].data as { tool_call_id: string }).tool_call_id).toBe('call_1');

    const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
    expect(toolDeltas).toHaveLength(1);
    expect((toolDeltas[0].data as { delta: string }).delta).toBe('"test"}');
  });

  it('should normalize magistral thinking chunks to reasoning_delta events', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('mistral');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          data: {
            choices: [{
              delta: {
                content: [
                  { type: 'thinking', thinking: [{ type: 'text', text: 'Let me think...' }] },
                ],
              },
            }],
          },
        };
        yield {
          data: {
            choices: [{
              delta: {
                content: [
                  { type: 'text', text: 'The answer is 42' },
                ],
              },
            }],
          },
        };
        yield {
          data: {
            choices: [{ delta: {}, finish_reason: 'stop' }],
          },
        };
      })(),
    );

    const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIResponseStream({
        messages: [{ role: 'user', content: 'What is the meaning of life?' }],
        providerId: 'mistral',
        model: 'magistral-medium-2509',
      }),
    );

    const reasoningDeltas = events.filter((e) => e.type === 'reasoning_delta');
    expect(reasoningDeltas).toHaveLength(1);
    expect((reasoningDeltas[0].data as { delta: string }).delta).toBe('Let me think...');

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(1);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('The answer is 42');

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('should emit status started event at the beginning', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('mistral');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'mistral',
        model: 'magistral-medium-2509',
      }),
    );

    expect(events[0].type).toBe('status');
    expect((events[0].data as { state: string }).state).toBe('started');
  });
});

describe('Devstral stream event normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should normalize content delta for devstral-2512', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('mistral');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'Hello' } }] } };
        yield { data: { choices: [{ delta: { content: ' from Devstral' } }] } };
        yield { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } };
      })(),
    );

    const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIResponseStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'mistral',
        model: 'devstral-2512',
      }),
    );

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(2);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('Hello');
    expect((contentDeltas[1].data as { delta: string }).delta).toBe(' from Devstral');

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('should normalize tool calls for devstral-2512', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('mistral');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          data: {
            choices: [{
              delta: {
                tool_calls: [{
                  id: 'call_dev_1',
                  index: 0,
                  function: { name: 'run_code', arguments: '{"lang":' },
                }],
              },
            }],
          },
        };
        yield {
          data: {
            choices: [{
              delta: {
                tool_calls: [{
                  id: 'call_dev_1',
                  index: 0,
                  function: { arguments: '"python"}' },
                }],
              },
            }],
          },
        };
        yield { data: { choices: [{ delta: {}, finish_reason: 'tool_calls' }] } };
      })(),
    );

    const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIResponseStream({
        messages: [{ role: 'user', content: 'Run some code' }],
        providerId: 'mistral',
        model: 'devstral-2512',
      }),
    );

    const toolStarts = events.filter((e) => e.type === 'tool_call_start');
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0].data as { name: string }).name).toBe('run_code');
    expect((toolStarts[0].data as { tool_call_id: string }).tool_call_id).toBe('call_dev_1');

    const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
    expect(toolDeltas).toHaveLength(1);
    expect((toolDeltas[0].data as { delta: string }).delta).toBe('"python"}');
  });
});
