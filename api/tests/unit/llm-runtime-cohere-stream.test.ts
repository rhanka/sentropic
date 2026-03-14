import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all external dependencies to isolate stream normalization logic
vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({
      defaultProviderId: 'cohere',
      defaultModel: 'command-a-03-2025',
      concurrency: 1,
      publishingConcurrency: 1,
      processingInterval: 1000,
    }),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'cohere',
    credential: 'test-key',
    source: 'environment',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    COHERE_API_KEY: 'test-cohere-key',
    OPENAI_API_KEY: 'test-openai-key',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    MISTRAL_API_KEY: '',
  },
}));

vi.mock('cohere-ai', () => {
  return {
    CohereClient: vi.fn().mockImplementation(() => ({
      v2: {
        chat: vi.fn(),
        chatStream: vi.fn(),
      },
    })),
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn() },
  })),
}));

vi.mock('@mistralai/mistralai', () => ({
  Mistral: vi.fn().mockImplementation(() => ({
    chat: { complete: vi.fn(), stream: vi.fn() },
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

describe('Cohere stream event normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should normalize content-delta events to content_delta', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('cohere');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          type: 'content-delta',
          delta: { message: { content: { text: 'Hello' } } },
        };
        yield {
          type: 'content-delta',
          delta: { message: { content: { text: ' world' } } },
        };
        yield { type: 'message-end' };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'cohere',
        model: 'command-a-03-2025',
      }),
    );

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(2);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('Hello');
    expect((contentDeltas[1].data as { delta: string }).delta).toBe(' world');

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('should normalize tool-call-start and tool-call-delta events', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('cohere');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          type: 'tool-call-start',
          delta: {
            tool_call: {
              id: 'cohere_tc_1',
              function: { name: 'search' },
            },
          },
        };
        yield {
          type: 'tool-call-delta',
          delta: {
            tool_call: {
              id: 'cohere_tc_1',
              function: { arguments: '{"query":"test"}' },
            },
          },
        };
        yield { type: 'message-end' };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Search' }],
        providerId: 'cohere',
        model: 'command-a-03-2025',
      }),
    );

    const toolStarts = events.filter((e) => e.type === 'tool_call_start');
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0].data as { name: string }).name).toBe('search');
    expect((toolStarts[0].data as { tool_call_id: string }).tool_call_id).toBe('cohere_tc_1');

    const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
    expect(toolDeltas).toHaveLength(1);
    expect((toolDeltas[0].data as { delta: string }).delta).toBe('{"query":"test"}');
  });

  it('should normalize tool-call-start with name field directly', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('cohere');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          type: 'tool-call-start',
          delta: {
            message: {
              toolCalls: {
                id: 'cohere_tc_2',
                type: 'function',
                function: { name: 'calculator', arguments: '' },
              },
            },
          },
        };
        yield { type: 'message-end' };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Calculate' }],
        providerId: 'cohere',
        model: 'command-a-03-2025',
      }),
    );

    const toolStarts = events.filter((e) => e.type === 'tool_call_start');
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0].data as { name: string }).name).toBe('calculator');
  });

  it('should normalize thinking content-delta to reasoning_delta events', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('cohere');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        // thinking blocks
        yield {
          type: 'content-delta',
          delta: { message: { content: { thinking: 'Let me analyze...' } } },
        };
        yield {
          type: 'content-delta',
          delta: { message: { content: { thinking: ' the problem' } } },
        };
        // text block
        yield {
          type: 'content-delta',
          delta: { message: { content: { text: 'The answer is 42' } } },
        };
        yield { type: 'message-end' };
      })(),
    );

    const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIResponseStream({
        messages: [{ role: 'user', content: 'Think about this' }],
        providerId: 'cohere',
        model: 'command-a-reasoning-08-2025',
      }),
    );

    const reasoningDeltas = events.filter((e) => e.type === 'reasoning_delta');
    expect(reasoningDeltas).toHaveLength(2);
    expect((reasoningDeltas[0].data as { delta: string }).delta).toBe('Let me analyze...');
    expect((reasoningDeltas[1].data as { delta: string }).delta).toBe(' the problem');

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(1);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('The answer is 42');

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('should emit status started event at the beginning', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('cohere');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { type: 'message-end' };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'cohere',
        model: 'command-a-03-2025',
      }),
    );

    expect(events[0].type).toBe('status');
    expect((events[0].data as { state: string }).state).toBe('started');
  });
});
