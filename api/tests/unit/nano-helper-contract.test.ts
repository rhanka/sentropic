import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/llm-runtime', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
vi.mock('../../src/services/stream-service', () => ({
  generateStreamId: () => 'offline-stream', getNextSequence: async () => 1, writeStreamEvent: vi.fn(),
}));

import { callLLM, callLLMStream } from '../../src/services/llm-runtime';
import * as chatModule from '../../src/services/chat-service';
import { executeWithToolsStream } from '../../src/services/tools';

const chat = chatModule.chatService as any;
const generate = vi.mocked(callLLM);
const stream = vi.mocked(callLLMStream);

beforeEach(() => {
  vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna');
  generate.mockReset(); stream.mockReset();
  generate.mockResolvedValue({ choices: [{ message: { content: 'Project Atlas' } }] } as any);
});
afterEach(() => vi.unstubAllEnvs());

describe('former nano product helpers', () => {
  it.each(['gpt-6-luna', 'gpt-5.6-luna'])('should use configured %s for bounded titles and effort evaluation', async (model) => {
    vi.stubEnv('OPENAI_MODEL', model);
    expect(await chat.generateSessionTitle({ lastUserMessage: 'Plan Project Atlas' })).toBe('Project Atlas');
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ model, reasoningEffort: 'none', maxOutputTokens: 32 }));
    stream.mockImplementation(async function* () {
      yield { type: 'content_delta', data: { delta: 'low' } };
      yield { type: 'done', data: {} };
    });
    const result = await chat.evaluateReasoningEffortInternal({
      selectedProviderId: 'openai', selectedModel: model, userId: '', workspaceId: '',
      conversation: [{ role: 'user', content: 'Say hello.' }],
    });
    expect(result).toMatchObject({ effortLabel: 'low', evaluatedBy: model });
    expect(result.failure).toBeUndefined();
    expect(stream).toHaveBeenLastCalledWith(expect.objectContaining({ model, reasoningEffort: 'none', maxOutputTokens: 64 }));
  });

  it('should compact a Mistral conversation with the configured OpenAI helper and retain its facts', async () => {
    const compact = (chatModule as any).compactConversationContext;
    generate.mockResolvedValue({ choices: [{ message: { content: '- Atlas: deadline October 23; budget USD 150.' } }] } as any);
    const result = await compact({
      providerId: 'mistral', modelId: 'devstral-2512', userId: '', workspaceId: '',
      messages: [{ role: 'system', content: 'Keep facts.' }, ...Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user', content: index === 0 ? 'Atlas deadline October 23; budget USD 150.' : `Turn ${index}`,
      }))],
    });
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({
      providerId: 'openai', model: 'gpt-6-luna', reasoningEffort: 'none', maxOutputTokens: 700,
    }));
    expect(result.compactedMessages[0].content).toContain('Atlas: deadline October 23; budget USD 150');
    expect(result.compactedMessages).toHaveLength(9);
  });

  it('should forward medium reasoning to the main turn when effort evaluation fails', async () => {
    stream.mockImplementation(async function* () { throw new Error('Offline evaluator failure'); });
    const result = await chat.evaluateReasoningEffortInternal({
      selectedProviderId: 'openai', selectedModel: 'gpt-6-luna', userId: '', workspaceId: '',
      conversation: [{ role: 'user', content: 'Compare these security architectures.' }],
    });
    expect(result).toMatchObject({ effortLabel: 'medium', effortForMessage: 'medium', evaluatedBy: 'fallback' });
  });

  it('should retain the same cap on a tool follow-up after rejected extraction arguments', async () => {
    stream.mockImplementationOnce(async function* () {
      yield { type: 'tool_call_start', data: { tool_call_id: 'offline-call', name: 'web_extract', args: '{"urls":[]}' } };
      yield { type: 'done', data: {} };
    }).mockImplementationOnce(async function* () {
      yield { type: 'content_delta', data: { delta: '{"ok":true}' } };
      yield { type: 'done', data: {} };
    });
    const result = await executeWithToolsStream('Return JSON.', { useWebSearch: true, responseFormat: 'json_object', maxOutputTokens: 128 });
    expect(result.content).toBe('{"ok":true}');
    expect(stream).toHaveBeenCalledTimes(2);
    for (const [options] of stream.mock.calls) {
      expect(options).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'none', maxOutputTokens: 128 });
    }
  });
});
