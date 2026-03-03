import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('../../src/services/openai', () => ({
  callOpenAI: vi.fn(),
}));

import { db } from '../../src/db/client';
import { chatMessages, chatSessions, users, workspaces, workspaceMemberships } from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import { toolService } from '../../src/services/tool-service';
import { callOpenAI } from '../../src/services/openai';

const mockedCallOpenAI = vi.mocked(callOpenAI);

describe('toolService.analyzeHistory', () => {
  let userId: string;
  let workspaceId: string;
  let sessionId: string;

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `history-analyze-${userId}@example.com`,
      displayName: 'History Analyze User',
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
      title: 'History analyze test session',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    await db.insert(chatMessages).values([
      {
        id: createId(),
        sessionId,
        role: 'user',
        content: 'Première question utilisateur',
        sequence: 1,
        createdAt: now,
      },
      {
        id: createId(),
        sessionId,
        role: 'assistant',
        content: 'Première réponse assistant',
        sequence: 2,
        createdAt: now,
      },
      {
        id: createId(),
        sessionId,
        role: 'tool',
        content: '{"result":"tool payload"}',
        toolCallId: 'tool_call_1',
        sequence: 3,
        createdAt: now,
      },
      {
        id: createId(),
        sessionId,
        role: 'assistant',
        content: 'Réponse basée sur le résultat tool',
        sequence: 4,
        createdAt: now,
      },
    ]);

    mockedCallOpenAI.mockReset();
  });

  afterEach(async () => {
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    await db
      .delete(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    vi.clearAllMocks();
  });

  it('returns answer + evidence + coverage on valid history scope', async () => {
    mockedCallOpenAI.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Réponse historique ciblée avec références.',
          },
        },
      ],
    } as any);

    const result = await toolService.analyzeHistory({
      workspaceId,
      sessionId,
      question: 'Quelle est la conclusion principale ?',
      includeToolResults: true,
    });

    expect(result.answer).toContain('Réponse historique ciblée');
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.coverage.scannedTurns).toBe(4);
    expect(result.coverage.totalTurns).toBe(4);
    expect(result.coverage.insufficientCoverage).toBe(false);
    expect(result.coverage.chunked).toBe(false);
    expect(result.confidence).toMatch(/low|medium|high/);
  });

  it('supports target_tool_call_id and truncation by max_turns', async () => {
    mockedCallOpenAI.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Réponse focalisée sur le tool call.',
          },
        },
      ],
    } as any);

    const result = await toolService.analyzeHistory({
      workspaceId,
      sessionId,
      question: 'Que dit le dernier résultat tool ?',
      targetToolCallId: 'tool_call_1',
      maxTurns: 2,
      includeToolResults: true,
    });

    expect(result.answer).toContain('Réponse focalisée');
    expect(result.coverage.scannedTurns).toBeLessThanOrEqual(2);
    expect(result.coverage.truncated).toBe(true);
  });

  it('rejects history analysis when session workspace mismatches', async () => {
    mockedCallOpenAI.mockResolvedValue({
      choices: [{ message: { content: 'N/A' } }],
    } as any);

    await expect(
      toolService.analyzeHistory({
        workspaceId: createId(),
        sessionId,
        question: 'Test',
      }),
    ).rejects.toThrow('session does not match workspace');
  });
});
