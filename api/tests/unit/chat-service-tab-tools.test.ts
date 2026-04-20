import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import {
  chatMessages,
  chatSessions,
  chatStreamEvents,
  folders,
  users,
  workspaces,
  workspaceMemberships,
} from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import {
  register as registerTab,
  clearAll as clearTabRegistry,
} from '../../src/services/tab-registry';

// Mock OpenAI streaming — must be declared before importing chatService.
vi.mock('../../src/services/llm-runtime', () => {
  return {
    callLLMStream: vi.fn(),
  };
});

import { callLLMStream } from '../../src/services/llm-runtime';
import { chatService } from '../../src/services/chat-service';

type StreamEvent = { type: string; data: unknown };

async function* stream(events: StreamEvent[]): AsyncGenerator<StreamEvent, void, unknown> {
  for (const e of events) yield e;
}

function toolNames(tools: any[] | undefined): string[] {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => (t && typeof t === 'object' ? (t as any).function?.name : undefined))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

describe('ChatService - tab tool injection (unit, mocked OpenAI)', () => {
  let userId: string;
  let workspaceId: string;
  let folderId: string;

  beforeEach(async () => {
    clearTabRegistry();

    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `tab-test-${userId}@example.com`,
      displayName: 'Tab Test User',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    ({ workspaceId } = await ensureWorkspaceForUser(userId));

    folderId = createId();
    await db.insert(folders).values({
      id: folderId,
      workspaceId,
      name: 'Folder for tab-tools tests',
      description: 'Desc',
      matrixConfig: JSON.stringify({ valueAxes: [], complexityAxes: [] }),
      executiveSummary: JSON.stringify({ introduction: '' }),
      status: 'completed',
      createdAt: new Date(),
    });
  });

  afterEach(async () => {
    clearTabRegistry();
    await db.delete(chatStreamEvents);
    await db.delete(chatMessages);
    await db.delete(chatSessions).where(eq(chatSessions.userId, userId));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
    vi.clearAllMocks();
  });

  it('should inject tab_read and tab_action when tabs are registered and client has no local tools', async () => {
    // Register a tab for this user
    registerTab({
      tab_id: 'test-tab-1',
      source: 'bookmarklet',
      url: 'https://example.com',
      title: 'Example Page',
      userId,
    });

    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    let capturedTools: string[] = [];

    mock.mockImplementation((opts: any) => {
      capturedTools = toolNames(opts?.tools);
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]);
    });

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'test tab injection',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    // No localToolDefinitions — webapp context
    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
    });

    expect(capturedTools).toContain('tab_read');
    expect(capturedTools).toContain('tab_action');
  });

  it('should NOT inject server tab tools when client already provides local tab tools', async () => {
    // Register a tab
    registerTab({
      tab_id: 'chrome-tab-1',
      source: 'chrome_plugin',
      url: 'https://example.com',
      title: 'Chrome Tab',
      userId,
    });

    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    let capturedTools: string[] = [];

    mock.mockImplementation((opts: any) => {
      capturedTools = toolNames(opts?.tools);
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]);
    });

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'test with local tools',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    // Client provides local tab_read — chrome plugin context
    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
      localToolDefinitions: [
        {
          name: 'tab_read',
          description: 'Read active tab content',
          parameters: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'tab_action',
          description: 'Perform action on active tab',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
    });

    // tab_read/tab_action should still be present (from client definitions), but
    // the server should NOT have added its own definitions on top.
    // We verify by checking the tool count — with client definitions there should
    // be exactly one tab_read and one tab_action (not duplicated).
    const tabReadCount = capturedTools.filter((n) => n === 'tab_read').length;
    const tabActionCount = capturedTools.filter((n) => n === 'tab_action').length;
    expect(tabReadCount).toBe(1);
    expect(tabActionCount).toBe(1);
  });

  it('should NOT inject tab tools when no tabs are registered', async () => {
    // No tabs registered for this user

    const mock = callLLMStream as unknown as ReturnType<typeof vi.fn>;
    let capturedTools: string[] = [];

    mock.mockImplementation((opts: any) => {
      capturedTools = toolNames(opts?.tools);
      return stream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} },
      ]);
    });

    const { sessionId, assistantMessageId, model } =
      await chatService.createUserMessageWithAssistantPlaceholder({
        userId,
        workspaceId,
        content: 'test no tabs',
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: 'gpt-4.1-nano',
      });

    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model,
    });

    expect(capturedTools).not.toContain('tab_read');
    expect(capturedTools).not.toContain('tab_action');
  });
});
