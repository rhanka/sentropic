import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all external dependencies to isolate stream normalization logic
vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({
      defaultProviderId: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      concurrency: 1,
      publishingConcurrency: 1,
      processingInterval: 1000,
    }),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'anthropic',
    credential: 'test-key',
    source: 'environment',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
    GEMINI_API_KEY: '',
    MISTRAL_API_KEY: '',
    COHERE_API_KEY: '',
  },
}));

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
        stream: vi.fn(),
      },
    })),
  };
});

vi.mock('cohere-ai', () => ({
  CohereClient: vi.fn().mockImplementation(() => ({
    v2: { chat: vi.fn(), chatStream: vi.fn() },
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

describe('Claude stream event normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should normalize text_delta to content_delta events', async () => {
    // Mock the Claude provider's streamGenerate to return Claude-native events
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('anthropic');
    const mockStreamGenerate = vi.fn().mockResolvedValue(
      (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' }, index: 0 };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' }, index: 0 };
        yield { type: 'message_stop' };
      })(),
    );
    vi.spyOn(provider, 'streamGenerate').mockImplementation(mockStreamGenerate);

    const { callOpenAIStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
      }),
    );

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(2);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('Hello');
    expect((contentDeltas[1].data as { delta: string }).delta).toBe(' world');

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('should normalize thinking_delta to reasoning_delta events', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('anthropic');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think...' }, index: 0 };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' }, index: 1 };
        yield { type: 'message_stop' };
      })(),
    );

    const { callOpenAIStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIStream({
        messages: [{ role: 'user', content: 'Think about this' }],
        providerId: 'anthropic',
        model: 'claude-opus-4-6',
      }),
    );

    const reasoningDeltas = events.filter((e) => e.type === 'reasoning_delta');
    expect(reasoningDeltas).toHaveLength(1);
    expect((reasoningDeltas[0].data as { delta: string }).delta).toBe('Let me think...');
  });

  it('should normalize tool_use content blocks to tool_call_start and tool_call_delta events', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('anthropic');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'search' },
        };
        yield {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"query":' },
        };
        yield {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"test"}' },
        };
        yield { type: 'message_stop' };
      })(),
    );

    const { callOpenAIStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIStream({
        messages: [{ role: 'user', content: 'Search for something' }],
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
      }),
    );

    const toolStarts = events.filter((e) => e.type === 'tool_call_start');
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0].data as { name: string }).name).toBe('search');
    expect((toolStarts[0].data as { tool_call_id: string }).tool_call_id).toBe('claude_call_1');

    const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
    expect(toolDeltas).toHaveLength(2);
    expect((toolDeltas[0].data as { delta: string }).delta).toBe('{"query":');
    expect((toolDeltas[1].data as { delta: string }).delta).toBe('"test"}');
  });

  it('should emit status started event at the beginning', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('anthropic');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { type: 'message_stop' };
      })(),
    );

    const { callOpenAIStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
      }),
    );

    expect(events[0].type).toBe('status');
    expect((events[0].data as { state: string }).state).toBe('started');
  });
});
