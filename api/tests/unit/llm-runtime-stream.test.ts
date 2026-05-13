import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock setup — isolate stream normalization logic from all SDKs
// ---------------------------------------------------------------------------

vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({
      defaultProviderId: 'openai',
      defaultModel: 'gpt-4.1-nano',
      concurrency: 1,
      publishingConcurrency: 1,
      processingInterval: 1000,
    }),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'openai',
    credential: 'test-key',
    source: 'environment',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
    GEMINI_API_KEY: 'test-gemini-key',
    MISTRAL_API_KEY: 'test-mistral-key',
    COHERE_API_KEY: 'test-cohere-key',
  },
}));

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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

import type { StreamEvent } from '../../src/services/llm-runtime';

async function collectStreamEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Per-model fixture matrix
// ---------------------------------------------------------------------------

interface ToolCallExpectation {
  startCount: number;
  startName: string;
  startToolCallId?: string;
  startArgs?: string;
  deltaCount: number;
  deltas?: string[];
}

interface ReasoningExpectation {
  count: number;
  deltas: string[];
  contentCount?: number;
  contentDeltas?: string[];
  hasDone?: boolean;
}

interface StreamTestConfig {
  providerId: string;
  model: string;
  label: string;

  // Chat / content test
  chatEvents: unknown[];
  expectedContentCount: number;
  expectedContentDeltas: string[];

  // Tool call test — null means skip
  toolEvents: unknown[] | null;
  expectedTools: ToolCallExpectation | null;

  // Reasoning test — null means skip
  reasoningEvents: unknown[] | null;
  expectedReasoning: ReasoningExpectation | null;

  // Status test
  statusEvents: unknown[];
}

const STREAM_TEST_MATRIX: StreamTestConfig[] = [
  // -----------------------------------------------------------------------
  // Anthropic — Claude Sonnet
  // -----------------------------------------------------------------------
  {
    providerId: 'anthropic',
    model: 'claude-sonnet-4-6',
    label: 'Claude Sonnet',
    chatEvents: [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' }, index: 0 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' }, index: 0 },
      { type: 'message_stop' },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'search' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"test"}' },
      },
      { type: 'message_stop' },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'claude_call_1',
      deltaCount: 2,
      deltas: ['{"query":', '"test"}'],
    },
    reasoningEvents: [
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Sonnet thought' }, index: 0 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' }, index: 1 },
      { type: 'message_stop' },
    ],
    expectedReasoning: {
      count: 1,
      deltas: ['Sonnet thought'],
      contentCount: 1,
      contentDeltas: ['Answer'],
      hasDone: true,
    },
    statusEvents: [{ type: 'message_stop' }],
  },

  // -----------------------------------------------------------------------
  // Anthropic — Claude Opus (with reasoning)
  // -----------------------------------------------------------------------
  {
    providerId: 'anthropic',
    model: 'claude-opus-4-7',
    label: 'Claude Opus',
    chatEvents: [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' }, index: 0 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' }, index: 0 },
      { type: 'message_stop' },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'search' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"test"}' },
      },
      { type: 'message_stop' },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'claude_call_1',
      deltaCount: 2,
      deltas: ['{"query":', '"test"}'],
    },
    reasoningEvents: [
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think...' }, index: 0 },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' }, index: 1 },
      { type: 'message_stop' },
    ],
    expectedReasoning: {
      count: 1,
      deltas: ['Let me think...'],
    },
    statusEvents: [{ type: 'message_stop' }],
  },

  // -----------------------------------------------------------------------
  // Mistral — Magistral Medium
  // -----------------------------------------------------------------------
  {
    providerId: 'mistral',
    model: 'magistral-medium-2509',
    label: 'Magistral Medium',
    chatEvents: [
      { data: { choices: [{ delta: { content: 'Hello' } }] } },
      { data: { choices: [{ delta: { content: ' world' } }] } },
      { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      {
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
      },
      {
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
      },
      { data: { choices: [{ delta: {}, finish_reason: 'tool_calls' }] } },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'call_1',
      deltaCount: 1,
      deltas: ['"test"}'],
    },
    reasoningEvents: [
      {
        data: {
          choices: [{
            delta: {
              content: [
                { type: 'thinking', thinking: [{ type: 'text', text: 'Let me think...' }] },
              ],
            },
          }],
        },
      },
      {
        data: {
          choices: [{
            delta: {
              content: [
                { type: 'text', text: 'The answer is 42' },
              ],
            },
          }],
        },
      },
      {
        data: {
          choices: [{ delta: {}, finish_reason: 'stop' }],
        },
      },
    ],
    expectedReasoning: {
      count: 1,
      deltas: ['Let me think...'],
      contentCount: 1,
      contentDeltas: ['The answer is 42'],
      hasDone: true,
    },
    statusEvents: [
      { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } },
    ],
  },

  // -----------------------------------------------------------------------
  // Mistral — Mistral Small
  // -----------------------------------------------------------------------
  {
    providerId: 'mistral',
    model: 'mistral-small-2603',
    label: 'Mistral Small 4',
    chatEvents: [
      { data: { choices: [{ delta: { content: 'Hello' } }] } },
      { data: { choices: [{ delta: { content: ' from Devstral' } }] } },
      { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' from Devstral'],
    toolEvents: [
      {
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
      },
      {
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
      },
      { data: { choices: [{ delta: {}, finish_reason: 'tool_calls' }] } },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'run_code',
      startToolCallId: 'call_dev_1',
      deltaCount: 1,
      deltas: ['"python"}'],
    },
    reasoningEvents: [
      {
        data: {
          choices: [{
            delta: {
              content: [
                { type: 'thinking', thinking: [{ type: 'text', text: 'Mistral small thought' }] },
              ],
            },
          }],
        },
      },
      {
        data: {
          choices: [{
            delta: {
              content: [
                { type: 'text', text: 'Small answer' },
              ],
            },
          }],
        },
      },
      {
        data: {
          choices: [{ delta: {}, finish_reason: 'stop' }],
        },
      },
    ],
    expectedReasoning: {
      count: 1,
      deltas: ['Mistral small thought'],
      contentCount: 1,
      contentDeltas: ['Small answer'],
      hasDone: true,
    },
    statusEvents: [
      { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } },
    ],
  },

  // -----------------------------------------------------------------------
  // Cohere — Command A
  // -----------------------------------------------------------------------
  {
    providerId: 'cohere',
    model: 'command-a-03-2025',
    label: 'Command A',
    chatEvents: [
      { type: 'content-delta', delta: { message: { content: { text: 'Hello' } } } },
      { type: 'content-delta', delta: { message: { content: { text: ' world' } } } },
      { type: 'message-end' },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      {
        type: 'tool-call-start',
        delta: {
          tool_call: {
            id: 'cohere_tc_1',
            function: { name: 'search' },
          },
        },
      },
      {
        type: 'tool-call-delta',
        delta: {
          tool_call: {
            id: 'cohere_tc_1',
            function: { arguments: '{"query":"test"}' },
          },
        },
      },
      { type: 'message-end' },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'cohere_tc_1',
      deltaCount: 1,
      deltas: ['{"query":"test"}'],
    },
    reasoningEvents: [
      { type: 'content-delta', delta: { message: { content: { thinking: 'Let me analyze...' } } } },
      { type: 'content-delta', delta: { message: { content: { thinking: ' the problem' } } } },
      { type: 'content-delta', delta: { message: { content: { text: 'The answer is 42' } } } },
      { type: 'message-end' },
    ],
    expectedReasoning: {
      count: 2,
      deltas: ['Let me analyze...', ' the problem'],
      contentCount: 1,
      contentDeltas: ['The answer is 42'],
      hasDone: true,
    },
    statusEvents: [{ type: 'message-end' }],
  },

  // -----------------------------------------------------------------------
  // Cohere — Command A Reasoning (reasoning model variant)
  // -----------------------------------------------------------------------
  {
    providerId: 'cohere',
    model: 'command-a-reasoning-08-2025',
    label: 'Command A Reasoning',
    chatEvents: [
      { type: 'content-delta', delta: { message: { content: { text: 'Reasoning hello' } } } },
      { type: 'message-end' },
    ],
    expectedContentCount: 1,
    expectedContentDeltas: ['Reasoning hello'],
    toolEvents: [
      {
        type: 'tool-plan-delta',
        delta: { message: { toolPlan: 'I should call a tool' } },
      },
      {
        type: 'tool-call-start',
        delta: {
          tool_call: {
            id: 'cohere_reasoning_tc_1',
            function: { name: 'search' },
          },
        },
      },
      {
        type: 'tool-call-delta',
        delta: {
          tool_call: {
            function: { arguments: '{"query":"reasoning"}' },
          },
        },
      },
      { type: 'message-end' },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'cohere_reasoning_tc_1',
      deltaCount: 1,
      deltas: ['{"query":"reasoning"}'],
    },
    reasoningEvents: [
      { type: 'tool-plan-delta', delta: { message: { toolPlan: 'Plan first' } } },
      { type: 'content-delta', delta: { message: { content: { thinking: 'Thinking block' } } } },
      { type: 'content-delta', delta: { message: { content: { text: 'Final answer' } } } },
      { type: 'message-end' },
    ],
    expectedReasoning: {
      count: 2,
      deltas: ['Plan first', 'Thinking block'],
      contentCount: 1,
      contentDeltas: ['Final answer'],
      hasDone: true,
    },
    statusEvents: [{ type: 'message-end' }],
  },

  // -----------------------------------------------------------------------
  // OpenAI — GPT-4.1-nano (standard)
  // -----------------------------------------------------------------------
  {
    providerId: 'openai',
    model: 'gpt-4.1-nano',
    label: 'GPT-4.1 Nano',
    chatEvents: [
      { type: 'response.created', response: { id: 'resp_test_123' } },
      { type: 'response.output_text.delta', delta: 'Hello' },
      { type: 'response.output_text.delta', delta: ' world' },
      { type: 'response.completed' },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      { type: 'response.created', response: { id: 'resp_test_456' } },
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_item_1',
          call_id: 'call_1',
          name: 'search',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_item_1',
        delta: '{"q":',
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_item_1',
        delta: '"test"}',
      },
      { type: 'response.completed' },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'call_1',
      deltaCount: 2,
      deltas: ['{"q":', '"test"}'],
    },
    reasoningEvents: null,
    expectedReasoning: null,
    statusEvents: [
      { type: 'response.created', response: { id: 'resp_test_000' } },
      { type: 'response.completed' },
    ],
  },

  // -----------------------------------------------------------------------
  // OpenAI — GPT-5.5 (reasoning model)
  // -----------------------------------------------------------------------
  {
    providerId: 'openai',
    model: 'gpt-5.5',
    label: 'GPT-5.5',
    chatEvents: [
      { type: 'response.created', response: { id: 'resp_test_123' } },
      { type: 'response.output_text.delta', delta: 'Hello' },
      { type: 'response.output_text.delta', delta: ' world' },
      { type: 'response.completed' },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      { type: 'response.created', response: { id: 'resp_test_556' } },
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_item_5',
          call_id: 'call_5',
          name: 'search',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_item_5',
        delta: '{"q":',
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_item_5',
        delta: '"reasoning"}',
      },
      { type: 'response.completed' },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'call_5',
      deltaCount: 2,
      deltas: ['{"q":', '"reasoning"}'],
    },
    reasoningEvents: [
      { type: 'response.created', response: { id: 'resp_test_789' } },
      { type: 'response.reasoning_text.delta', delta: 'Let me think...' },
      { type: 'response.reasoning_text.delta', delta: ' about this.' },
      { type: 'response.output_text.delta', delta: 'The answer is 42' },
      { type: 'response.completed' },
    ],
    expectedReasoning: {
      count: 2,
      deltas: ['Let me think...', ' about this.'],
      contentCount: 1,
      contentDeltas: ['The answer is 42'],
      hasDone: true,
    },
    statusEvents: [
      { type: 'response.created', response: { id: 'resp_test_000' } },
      { type: 'response.completed' },
    ],
  },

  // -----------------------------------------------------------------------
  // OpenAI — GPT-5.4 Nano (standard reasoning model)
  // -----------------------------------------------------------------------
  {
    providerId: 'openai',
    model: 'gpt-5.4-nano',
    label: 'GPT-5.4 Nano',
    chatEvents: [
      { type: 'response.created', response: { id: 'resp_nano_123' } },
      { type: 'response.output_text.delta', delta: 'Nano' },
      { type: 'response.output_text.delta', delta: ' answer' },
      { type: 'response.completed' },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Nano', ' answer'],
    toolEvents: [
      { type: 'response.created', response: { id: 'resp_nano_tool' } },
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_item_nano',
          call_id: 'call_nano',
          name: 'search',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'fc_item_nano',
        name: 'search',
        arguments: '{"q":"nano"}',
      },
      { type: 'response.completed' },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'call_nano',
      deltaCount: 1,
      deltas: ['{"q":"nano"}'],
    },
    reasoningEvents: [
      { type: 'response.created', response: { id: 'resp_nano_reasoning' } },
      { type: 'response.reasoning_summary_text.delta', delta: 'Nano summary' },
      { type: 'response.output_text.delta', delta: 'Nano final' },
      { type: 'response.completed' },
    ],
    expectedReasoning: {
      count: 1,
      deltas: ['Nano summary'],
      contentCount: 1,
      contentDeltas: ['Nano final'],
      hasDone: true,
    },
    statusEvents: [
      { type: 'response.created', response: { id: 'resp_nano_status' } },
      { type: 'response.completed' },
    ],
  },

  // -----------------------------------------------------------------------
  // Gemini — Flash Lite (standard)
  // -----------------------------------------------------------------------
  {
    providerId: 'gemini',
    model: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini Flash Lite',
    chatEvents: [
      { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] },
      { candidates: [{ content: { parts: [{ text: ' world' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'search', args: { query: 'test' } },
            }],
          },
        }],
      },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'gemini_call_1',
      startArgs: '{"query":"test"}',
      deltaCount: 0,
    },
    reasoningEvents: [
      {
        candidates: [{
          content: {
            parts: [
              { text: 'Flash thought', thought: true },
              { text: 'Flash answer' },
            ],
          },
          finishReason: 'STOP',
        }],
      },
    ],
    expectedReasoning: {
      count: 1,
      deltas: ['Flash thought'],
      contentCount: 1,
      contentDeltas: ['Flash answer'],
      hasDone: true,
    },
    statusEvents: [
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    ],
  },

  // -----------------------------------------------------------------------
  // Gemini — Pro Preview (reasoning model)
  // -----------------------------------------------------------------------
  {
    providerId: 'gemini',
    model: 'gemini-3.1-pro-preview-customtools',
    label: 'Gemini Pro Preview',
    chatEvents: [
      { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] },
      { candidates: [{ content: { parts: [{ text: ' world' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    ],
    expectedContentCount: 2,
    expectedContentDeltas: ['Hello', ' world'],
    toolEvents: [
      {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'search', args: { query: 'pro' } },
            }],
          },
        }],
      },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    ],
    expectedTools: {
      startCount: 1,
      startName: 'search',
      startToolCallId: 'gemini_call_1',
      startArgs: '{"query":"pro"}',
      deltaCount: 0,
    },
    reasoningEvents: [
      {
        candidates: [{
          content: {
            parts: [
              { text: 'Pro thought', thought: true },
              { text: 'Pro answer' },
            ],
          },
          finishReason: 'STOP',
        }],
      },
    ],
    expectedReasoning: {
      count: 1,
      deltas: ['Pro thought'],
      contentCount: 1,
      contentDeltas: ['Pro answer'],
      hasDone: true,
    },
    statusEvents: [
      {
        candidates: [{
          content: { parts: [{ text: 'Answer' }] },
          finishReason: 'STOP',
        }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Additional Cohere-specific tests that don't fit the matrix pattern
// ---------------------------------------------------------------------------

const COHERE_TOOL_START_NAME_VARIANT = {
  providerId: 'cohere',
  model: 'command-a-03-2025',
  label: 'Command A (toolCalls name variant)',
  events: [
    {
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
    },
    { type: 'message-end' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLM stream event normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has a stream fixture for every advertised model capability', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const matrixByKey = new Map(
      STREAM_TEST_MATRIX.map((config) => [`${config.providerId}:${config.model}`, config]),
    );
    const catalogModels = providerRegistry.listModels();

    expect([...matrixByKey.keys()].sort()).toEqual(
      catalogModels.map((model) => `${model.providerId}:${model.modelId}`).sort(),
    );

    for (const model of catalogModels) {
      const key = `${model.providerId}:${model.modelId}`;
      const config = matrixByKey.get(key);
      expect(config, key).toBeDefined();
      if (model.supportsTools) {
        expect(config?.toolEvents, `${key} tool fixture`).not.toBeNull();
      }
      if (model.reasoningTier !== 'none') {
        expect(config?.reasoningEvents, `${key} reasoning fixture`).not.toBeNull();
      }
    }
  });

  describe.each(STREAM_TEST_MATRIX)(
    '$label ($providerId / $model)',
    (config) => {
      it('should normalize content deltas', async () => {
        const { providerRegistry } = await import('../../src/services/provider-registry');
        const provider = providerRegistry.requireProvider(config.providerId);
        vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
          (async function* () {
            for (const evt of config.chatEvents) yield evt;
          })(),
        );

        const { callLLMStream } = await import('../../src/services/llm-runtime');

        const events = await collectStreamEvents(
          callLLMStream({
            messages: [{ role: 'user', content: 'Hi' }],
            providerId: config.providerId,
            model: config.model,
          }),
        );

        const contentDeltas = events.filter((e) => e.type === 'content_delta');
        expect(contentDeltas).toHaveLength(config.expectedContentCount);
        config.expectedContentDeltas.forEach((expected, i) => {
          expect((contentDeltas[i].data as { delta: string }).delta).toBe(expected);
        });

        const doneEvents = events.filter((e) => e.type === 'done');
        expect(doneEvents).toHaveLength(1);
      });

      it.skipIf(!config.toolEvents)('should normalize tool calls', async () => {
        const { providerRegistry } = await import('../../src/services/provider-registry');
        const provider = providerRegistry.requireProvider(config.providerId);
        vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
          (async function* () {
            for (const evt of config.toolEvents!) yield evt;
          })(),
        );

        const { callLLMStream } = await import('../../src/services/llm-runtime');

        const events = await collectStreamEvents(
          callLLMStream({
            messages: [{ role: 'user', content: 'Search something' }],
            providerId: config.providerId,
            model: config.model,
          }),
        );

        const toolStarts = events.filter((e) => e.type === 'tool_call_start');
        expect(toolStarts).toHaveLength(config.expectedTools!.startCount);
        expect((toolStarts[0].data as { name: string }).name).toBe(config.expectedTools!.startName);

        if (config.expectedTools!.startToolCallId) {
          expect((toolStarts[0].data as { tool_call_id: string }).tool_call_id).toBe(
            config.expectedTools!.startToolCallId,
          );
        }

        if (config.expectedTools!.startArgs) {
          expect((toolStarts[0].data as { args: string }).args).toBe(config.expectedTools!.startArgs);
        }

        const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
        expect(toolDeltas).toHaveLength(config.expectedTools!.deltaCount);
        if (config.expectedTools!.deltas) {
          config.expectedTools!.deltas.forEach((expected, i) => {
            expect((toolDeltas[i].data as { delta: string }).delta).toBe(expected);
          });
        }
      });

      it.skipIf(!config.reasoningEvents)('should normalize reasoning deltas', async () => {
        const { providerRegistry } = await import('../../src/services/provider-registry');
        const provider = providerRegistry.requireProvider(config.providerId);

        vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
          (async function* () {
            for (const evt of config.reasoningEvents!) yield evt;
          })(),
        );

        const { callLLMStream } = await import('../../src/services/llm-runtime');

        const events = await collectStreamEvents(
          callLLMStream({
            messages: [{ role: 'user', content: 'Think about this' }],
            providerId: config.providerId,
            model: config.model,
          }),
        );

        const reasoningDeltas = events.filter((e) => e.type === 'reasoning_delta');
        expect(reasoningDeltas).toHaveLength(config.expectedReasoning!.count);
        config.expectedReasoning!.deltas.forEach((expected, i) => {
          expect((reasoningDeltas[i].data as { delta: string }).delta).toBe(expected);
        });

        if (config.expectedReasoning!.contentCount != null) {
          const contentDeltas = events.filter((e) => e.type === 'content_delta');
          expect(contentDeltas).toHaveLength(config.expectedReasoning!.contentCount);
          if (config.expectedReasoning!.contentDeltas) {
            config.expectedReasoning!.contentDeltas.forEach((expected, i) => {
              expect((contentDeltas[i].data as { delta: string }).delta).toBe(expected);
            });
          }
        }

        if (config.expectedReasoning!.hasDone) {
          const doneEvents = events.filter((e) => e.type === 'done');
          expect(doneEvents).toHaveLength(1);
        }
      });

      it('should emit status started event at the beginning', async () => {
        const { providerRegistry } = await import('../../src/services/provider-registry');
        const provider = providerRegistry.requireProvider(config.providerId);
        vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
          (async function* () {
            for (const evt of config.statusEvents) yield evt;
          })(),
        );

        const { callLLMStream } = await import('../../src/services/llm-runtime');

        const events = await collectStreamEvents(
          callLLMStream({
            messages: [{ role: 'user', content: 'Hi' }],
            providerId: config.providerId,
            model: config.model,
          }),
        );

        expect(events[0].type).toBe('status');
        expect((events[0].data as { state: string }).state).toBe('started');
      });
    },
  );

  // -------------------------------------------------------------------------
  // Cohere-specific: tool-call-start with toolCalls name variant
  // -------------------------------------------------------------------------
  it('should normalize Cohere tool-call-start with name field directly', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider(COHERE_TOOL_START_NAME_VARIANT.providerId);
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        for (const evt of COHERE_TOOL_START_NAME_VARIANT.events) yield evt;
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Calculate' }],
        providerId: COHERE_TOOL_START_NAME_VARIANT.providerId,
        model: COHERE_TOOL_START_NAME_VARIANT.model,
      }),
    );

    const toolStarts = events.filter((e) => e.type === 'tool_call_start');
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0].data as { name: string }).name).toBe('calculator');
  });

  // -------------------------------------------------------------------------
  // Gemini Pro Preview: status + content (original test combined both)
  // -------------------------------------------------------------------------
  it('should emit status and content for Gemini Pro Preview', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gemini');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          candidates: [{
            content: { parts: [{ text: 'Answer' }] },
            finishReason: 'STOP',
          }],
        };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Think about this' }],
        providerId: 'gemini',
        model: 'gemini-3.1-pro-preview-customtools',
      }),
    );

    expect(events[0].type).toBe('status');
    expect((events[0].data as { state: string }).state).toBe('started');

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(1);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('Answer');

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('should keep Gemini thought parts out of assistant content', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gemini');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          candidates: [{
            content: {
              parts: [
                { text: 'hidden planning', thought: true },
                { text: 'Visible answer' },
              ],
            },
            finishReason: 'STOP',
          }],
        };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Answer' }],
        providerId: 'gemini',
        model: 'gemini-3.1-pro-preview-customtools',
      }),
    );

    const contentDeltas = events.filter((e) => e.type === 'content_delta');
    expect(contentDeltas).toHaveLength(1);
    expect((contentDeltas[0].data as { delta: string }).delta).toBe('Visible answer');

    const reasoningDeltas = events.filter((e) => e.type === 'reasoning_delta');
    expect(reasoningDeltas).toHaveLength(1);
    expect((reasoningDeltas[0].data as { delta: string }).delta).toBe('hidden planning');
  });

  it('should strip mesh reasoning for GPT-4.1 Nano when chat passes reasoning options', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('openai');
    let capturedRequest: unknown;
    vi.spyOn(provider, 'streamGenerate').mockImplementation(async (request) => {
      capturedRequest = request;
      return (async function* () {
        yield { type: 'response.created', response: { id: 'resp_no_reasoning' } };
        yield { type: 'response.output_text.delta', delta: 'No reasoning params' };
        yield { type: 'response.completed' };
      })();
    });

    const { callLLMStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'openai',
        model: 'gpt-4.1-nano',
        reasoningEffort: 'medium',
        reasoningSummary: 'auto',
      }),
    );

    const requestOptions = (capturedRequest as { requestOptions?: { reasoning?: unknown } }).requestOptions;
    expect(requestOptions?.reasoning).toBeUndefined();
    expect(events.some((event) => event.type === 'content_delta')).toBe(true);
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });
});
