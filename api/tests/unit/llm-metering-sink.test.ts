import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, values, onConflictDoNothing } = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoNothing: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  db: { insert },
}));

vi.mock('../../src/utils/id', () => ({
  createId: vi.fn(() => 'ledger_row_1'),
}));

import { costLedger } from '../../src/db/control-schema';
import { recordLlmUsage } from '../../src/services/llm-metering';

describe('recordLlmUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onConflictDoNothing.mockResolvedValue(undefined);
    values.mockReturnValue({ onConflictDoNothing });
    insert.mockReturnValue({ values });
  });

  it('persists normalized usage and stable dispatch attribution', async () => {
    await recordLlmUsage({
      callId: 'call_1',
      operation: 'stream',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      credentialSource: 'user_byok',
      userId: 'user_1',
      workspaceId: 'workspace_1',
      finishReason: 'stop',
      responseId: 'response_1',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 35,
        providerRawUsage: { prompt_tokens: 10, completion_tokens: 20 },
      },
    });

    expect(insert).toHaveBeenCalledWith(costLedger);
    expect(values).toHaveBeenCalledWith({
      id: 'ledger_row_1',
      idempotencyKey: 'call_1',
      userId: 'user_1',
      workspaceId: 'workspace_1',
      operation: 'stream',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      credentialSource: 'user_byok',
      finishReason: 'stop',
      responseId: 'response_1',
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 5,
      totalTokens: 35,
      usageRaw: { prompt_tokens: 10, completion_tokens: 20 },
      costMicroUsd: null,
    });
    expect(onConflictDoNothing).toHaveBeenCalledWith({ target: costLedger.idempotencyKey });
  });

  it('stores null optional fields when a provider does not report usage', async () => {
    await recordLlmUsage({
      callId: 'call_2',
      operation: 'generate',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'call_2',
      userId: null,
      workspaceId: null,
      credentialSource: null,
      finishReason: null,
      responseId: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      usageRaw: null,
      costMicroUsd: null,
    }));
  });
});
