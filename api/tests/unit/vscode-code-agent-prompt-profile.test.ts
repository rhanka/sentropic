import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

vi.mock('../../src/services/openai', () => {
  return {
    callOpenAI: vi.fn(),
    callOpenAIResponseStream: vi.fn(),
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
import { callOpenAIResponseStream } from '../../src/services/openai';
import { chatService } from '../../src/services/chat-service';
import type { VsCodeCodeAgentRuntimePayload } from '../../src/services/chat-service';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';

type StreamEvent = { type: string; data: unknown };

async function* stream(events: StreamEvent[]): AsyncGenerator<StreamEvent, void, unknown> {
  for (const event of events) {
    yield event;
  }
}

describe('VSCode code-agent prompt profile', () => {
  let userId: string;
  let workspaceId: string;
  let sessionId: string;

  const mockedCallOpenAIResponseStream = vi.mocked(callOpenAIResponseStream);

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `vscode-code-agent-${userId}@example.com`,
      displayName: 'VSCode Code Agent',
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
      title: 'VSCode prompt profile test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockedCallOpenAIResponseStream.mockReset();
    mockedCallOpenAIResponseStream.mockImplementation(() =>
      stream([
        { type: 'content_delta', data: { delta: 'Réponse test.' } },
        { type: 'done', data: {} },
      ]),
    );
  });

  afterEach(async () => {
    await db.delete(chatStreamEvents);
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    await db
      .delete(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
        ),
      );
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    vi.clearAllMocks();
  });

  const runWithPayload = async (payload: VsCodeCodeAgentRuntimePayload) => {
    const created = await chatService.createUserMessageWithAssistantPlaceholder({
      userId,
      workspaceId,
      sessionId,
      content: 'Lance une analyse.',
      model: 'gpt-4.1-nano',
    });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId: created.assistantMessageId,
      model: created.model,
      vscodeCodeAgent: payload,
    });
  };

  it('applies workspace override before global override and injects instruction files', async () => {
    await runWithPayload({
      source: 'vscode',
      workspaceKey: '/repo',
      workspaceLabel: 'repo',
      promptGlobalOverride: 'GLOBAL_OVERRIDE_MARKER',
      promptWorkspaceOverride: 'WORKSPACE_OVERRIDE_MARKER',
      instructionIncludePatterns: ['AGENTS.md', '.cursor/rules/*.mdc'],
      instructionFiles: [
        {
          path: 'AGENTS.md',
          content: 'Use rg first. Keep edits atomic.',
        },
      ],
    });

    expect(mockedCallOpenAIResponseStream).toHaveBeenCalled();
    const firstCall = mockedCallOpenAIResponseStream.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;
    const systemPrompt = firstCall?.messages?.[0]?.content ?? '';
    expect(systemPrompt).toContain('WORKSPACE_OVERRIDE_MARKER');
    expect(systemPrompt).not.toContain('GLOBAL_OVERRIDE_MARKER');
    expect(systemPrompt).toContain('--- AGENTS.md ---');
    expect(systemPrompt).toContain('Use rg first. Keep edits atomic.');
  });

  it('falls back to global override when workspace override is absent', async () => {
    await runWithPayload({
      source: 'vscode',
      promptGlobalOverride: 'GLOBAL_FALLBACK_MARKER',
      instructionFiles: [],
    });

    const firstCall = mockedCallOpenAIResponseStream.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;
    const systemPrompt = firstCall?.messages?.[0]?.content ?? '';
    expect(systemPrompt).toContain('GLOBAL_FALLBACK_MARKER');
  });

  it('blocks execution when resolved vscode prompt is invalid', async () => {
    const getPromptTemplate =
      (chatService as unknown as { getPromptTemplate: (id: string) => string })
        .getPromptTemplate.bind(chatService);
    const promptSpy = vi
      .spyOn(
        chatService as unknown as { getPromptTemplate: (id: string) => string },
        'getPromptTemplate',
      )
      .mockImplementation((id: string) =>
        id === 'chat_code_agent' ? '' : getPromptTemplate(id),
      );

    try {
      const created = await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        sessionId,
        content: 'Prompt invalide ?',
        model: 'gpt-4.1-nano',
      });

      await expect(
        chatService.runAssistantGeneration({
          userId,
          sessionId,
          assistantMessageId: created.assistantMessageId,
          model: created.model,
          vscodeCodeAgent: {
            source: 'vscode',
          },
        }),
      ).rejects.toThrow(/VSCode code-agent prompt is invalid/i);
      expect(mockedCallOpenAIResponseStream).not.toHaveBeenCalled();
    } finally {
      promptSpy.mockRestore();
    }
  });
});
