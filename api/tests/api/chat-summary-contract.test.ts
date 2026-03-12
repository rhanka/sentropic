import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/llm-runtime', () => {
  return {
    callOpenAI: vi.fn(),
    callOpenAIResponseStream: vi.fn(),
  };
});

import { app } from '../../src/app';
import { chatService } from '../../src/services/chat-service';
import { queueManager } from '../../src/services/queue-manager';
import { callOpenAIResponseStream } from '../../src/services/llm-runtime';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

type StreamEvent = { type: string; data: unknown };

async function* stream(events: StreamEvent[]): AsyncGenerator<StreamEvent, void, unknown> {
  for (const event of events) {
    yield event;
  }
}

describe('Chat summary contract endpoint', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;
  const mockedCallOpenAIResponseStream = vi.mocked(callOpenAIResponseStream);

  beforeEach(async () => {
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    user = await createAuthenticatedUser('editor');
    mockedCallOpenAIResponseStream.mockReset();
  });

  afterEach(async () => {
    await cleanupAuthData();
    processJobsSpy.mockRestore();
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it('exposes context budget status events in session bootstrap assistant details', async () => {
    mockedCallOpenAIResponseStream.mockImplementation(() =>
      stream([
        { type: 'content_delta', data: { delta: 'Réponse test budget.' } },
        { type: 'done', data: {} },
      ]),
    );

    const create = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        content: 'Test contrat budget contexte',
      },
    );
    expect(create.status).toBe(200);
    const payload = await create.json();

    await chatService.runAssistantGeneration({
      userId: user.id,
      sessionId: payload.sessionId,
      assistantMessageId: payload.assistantMessageId,
      model: 'gpt-4.1-nano',
    });

    const bootstrapResponse = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${payload.sessionId}/bootstrap`,
      user.sessionToken!,
    );
    expect(bootstrapResponse.status).toBe(200);
    const bootstrapPayload = await bootstrapResponse.json();
    const assistantDetails = bootstrapPayload?.assistantDetailsByMessageId?.[payload.assistantMessageId];
    const statusEvents = Array.isArray(assistantDetails)
      ? assistantDetails.filter((event: any) => event.eventType === 'status')
      : [];
    const states = statusEvents.map((event: any) => String(event.data?.state ?? ''));
    expect(states).toContain('context_budget_update');
  });
});
