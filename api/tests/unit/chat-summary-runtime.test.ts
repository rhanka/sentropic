import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('../../src/services/llm-runtime', () => {
  return {
    callLLM: vi.fn(),
    callLLMStream: vi.fn(),
  };
});

import { db } from '../../src/db/client';
import {
  chatMessages,
  chatSessions,
  chatStreamEvents,
  users,
  workspaceMemberships,
  workspaces,
} from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import { callLLM, callLLMStream } from '../../src/services/llm-runtime';
import { chatService } from '../../src/services/chat-service';

type StreamEvent = { type: string; data: unknown };

async function* stream(events: StreamEvent[]): AsyncGenerator<StreamEvent, void, unknown> {
  for (const event of events) {
    yield event;
  }
}

describe('Chat summary runtime (Lot 4)', () => {
  let userId: string;
  let workspaceId: string;
  let sessionId: string;
  let sequence = 1;

  const mockedCallLLM = vi.mocked(callLLM);
  const mockedCallLLMStream = vi.mocked(callLLMStream);

  const insertMessage = async (role: 'user' | 'assistant', content: string) => {
    const id = createId();
    await db.insert(chatMessages).values({
      id,
      sessionId,
      role,
      content,
      sequence: sequence++,
      createdAt: new Date(),
    });
    return id;
  };

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `chat-summary-runtime-${userId}@example.com`,
      displayName: 'Chat Summary Runtime',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    ({ workspaceId } = await ensureWorkspaceForUser(userId));

    sessionId = createId();
    await db.insert(chatSessions).values({
      id: sessionId,
      userId,
      workspaceId,
      title: 'Chat summary runtime test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    sequence = 1;
    mockedCallLLM.mockReset();
    mockedCallLLMStream.mockReset();
  });

  afterEach(async () => {
    await db.delete(chatStreamEvents);
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    await db
      .delete(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    vi.clearAllMocks();
  });

  it('compacts context when hard threshold is exceeded before model call', async () => {
    const huge = 'A'.repeat(950_000);
    await insertMessage('user', huge);
    await insertMessage('assistant', 'Historique long.');

    mockedCallLLM.mockResolvedValue({
      choices: [{ message: { content: '- Summary bullet 1\n- Summary bullet 2' } }],
    } as any);
    mockedCallLLMStream.mockImplementation(() =>
      stream([
        { type: 'content_delta', data: { delta: 'low' } },
        { type: 'done', data: {} },
      ]),
    );

    const created = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      sessionId,
      content: 'Continue',
      providerId: 'mistral',
      model: 'devstral-2512',
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId: created.assistantMessageId,
      providerId: 'mistral',
      model: created.model,
    });

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, created.assistantMessageId));
    const states = events
      .filter((event) => event.eventType === 'status')
      .map((event) => String((event.data as Record<string, unknown>)?.state ?? ''));

    expect(states).toContain('context_budget_update');
    expect(states).toContain('context_compaction_started');
    expect(states).toContain('context_compaction_done');
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
  });

  it('returns context_budget_risk deferred tool result before oversized tool dispatch', async () => {
    const nearSoft = 'B'.repeat(880_000);
    await insertMessage('user', nearSoft);

    mockedCallLLMStream
      .mockImplementationOnce(() =>
        stream([
          { type: 'content_delta', data: { delta: 'low' } },
          { type: 'done', data: {} },
        ]),
      )
      .mockImplementationOnce(() =>
        stream([
          {
            type: 'tool_call_start',
            data: {
              tool_call_id: 'call_web_search_1',
              name: 'web_search',
              args: JSON.stringify({ query: 'industrial digital twins in aluminum' }),
            },
          },
          { type: 'done', data: {} },
        ]),
      )
      .mockImplementationOnce(() =>
        stream([
          { type: 'content_delta', data: { delta: 'Je réduis la portée pour poursuivre.' } },
          { type: 'done', data: {} },
        ]),
      );

    const created = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      sessionId,
      content: 'Fais une extraction web exhaustive',
      providerId: 'mistral',
      model: 'devstral-2512',
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId: created.assistantMessageId,
      providerId: 'mistral',
      model: created.model,
      tools: ['web_search'],
    });

    const events = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, created.assistantMessageId));
    const deferredEvent = events.find((event) => {
      if (event.eventType !== 'tool_call_result') return false;
      const result = (event.data as Record<string, unknown>)?.result as Record<
        string,
        unknown
      >;
      return result?.status === 'deferred';
    });

    expect(deferredEvent).toBeDefined();
    const deferred = ((deferredEvent as any).data?.result ?? {}) as Record<string, unknown>;
    expect(deferred.code).toBe('context_budget_risk');
    expect(deferred.replan_required).toBe(true);
  });
});
