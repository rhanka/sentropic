import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/services/openai', () => ({
  callOpenAIResponseStream: vi.fn(),
  callOpenAI: vi.fn()
}));

vi.mock('../../src/services/context-comments', () => ({
  generateCommentResolutionProposal: vi.fn()
}));

import { app } from '../../src/app';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import {
  createAuthenticatedUser,
  authenticatedRequest,
  cleanupAuthData
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import {
  chatContexts,
  chatMessages,
  chatSessions,
  chatStreamEvents,
  comments,
  folders,
  organizations,
  workspaceMemberships,
  useCases
} from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { callOpenAIResponseStream } from '../../src/services/openai';
import { generateCommentResolutionProposal } from '../../src/services/context-comments';

const openAIStreamMock = callOpenAIResponseStream as unknown as ReturnType<typeof vi.fn>;
const proposalMock = generateCommentResolutionProposal as unknown as ReturnType<typeof vi.fn>;

const createStream = (events: Array<{ type: string; data?: Record<string, unknown> }>) =>
  ({
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  }) as AsyncIterable<{ type: string; data?: Record<string, unknown> }>;

describe('Chat tools API - comment_assistant', () => {
  let user: any;
  let viewer: any;
  let admin: any;
  let organizationId: string;
  let folderId: string;
  let useCaseId: string;
  let otherUseCaseId: string;
  const assistantMessageIds: string[] = [];
  const sessionIds: string[] = [];

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor', `editor-${createTestId()}@example.com`);
    viewer = await createAuthenticatedUser('guest', `viewer-${createTestId()}@example.com`);
    admin = await createAuthenticatedUser('admin', `admin-${createTestId()}@example.com`);

    if (user.workspaceId) {
      await db
        .insert(workspaceMemberships)
        .values({ workspaceId: user.workspaceId, userId: viewer.id, role: 'viewer', createdAt: new Date() })
        .onConflictDoNothing();
      await db
        .insert(workspaceMemberships)
        .values({ workspaceId: user.workspaceId, userId: admin.id, role: 'admin', createdAt: new Date() })
        .onConflictDoNothing();
    }

    const orgResponse = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Test Organization ${createTestId()}`,
      industry: 'Technology'
    });
    expect(orgResponse.status).toBe(201);
    organizationId = (await orgResponse.json()).id;

    const folderResponse = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder for comment tools',
      organizationId
    });
    expect(folderResponse.status).toBe(201);
    folderId = (await folderResponse.json()).id;

    const useCaseResponse = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, {
      name: `Test UC ${createTestId()}`,
      description: 'Test use case for comment tools',
      folderId
    });
    expect(useCaseResponse.status).toBe(201);
    useCaseId = (await useCaseResponse.json()).id;

    const otherUseCaseResponse = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, {
      name: `Other UC ${createTestId()}`,
      description: 'Another use case for scoping',
      folderId
    });
    expect(otherUseCaseResponse.status).toBe(201);
    otherUseCaseId = (await otherUseCaseResponse.json()).id;

    openAIStreamMock.mockImplementation(() =>
      createStream([
        { type: 'content_delta', data: { delta: 'OK' } },
        { type: 'done', data: {} }
      ])
    );
  });

  afterEach(async () => {
    for (const messageId of assistantMessageIds) {
      await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, messageId));
    }
    for (const sessionId of sessionIds) {
      await db.delete(chatContexts).where(eq(chatContexts.sessionId, sessionId));
      await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
      await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    }
    await db.delete(comments).where(eq(comments.contextId, useCaseId));
    await db.delete(comments).where(eq(comments.contextId, otherUseCaseId));
    await db.delete(useCases).where(eq(useCases.id, useCaseId));
    await db.delete(useCases).where(eq(useCases.id, otherUseCaseId));
    await db.delete(folders).where(eq(folders.id, folderId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    if (user.workspaceId) {
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
    assistantMessageIds.length = 0;
    sessionIds.length = 0;
    vi.clearAllMocks();
  });

  async function waitForJobCompletion(
    jobId: string,
    sessionToken: string,
    workspaceId?: string,
    maxAttempts: number = 15
  ): Promise<void> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      await sleep(500);
      const path = workspaceId ? `/api/v1/queue/jobs/${jobId}?workspace_id=${workspaceId}` : `/api/v1/queue/jobs/${jobId}`;
      const jobRes = await authenticatedRequest(app, 'GET', path, sessionToken);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      if (job && (job.status === 'completed' || job.status === 'failed')) {
        expect(job.status).toBe('completed');
        return;
      }
      attempts++;
    }
    throw new Error(`Job ${jobId} did not complete within ${maxAttempts} attempts`);
  }

  it('returns a proposal for comment_assistant suggest', async () => {
    const threadId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: createId(),
      workspaceId: user.workspaceId!,
      contextType: 'usecase',
      contextId: useCaseId,
      sectionKey: null,
      createdBy: user.id,
      assignedTo: user.id,
      status: 'open',
      threadId,
      content: 'Comment to resolve',
      createdAt: now,
      updatedAt: now
    });

    proposalMock.mockResolvedValue({
      summary_markdown: 'Résumé des commentaires.',
      actions: [{ thread_id: threadId, action: 'close' }],
      confirmation_prompt: 'Confirmer ?',
      confirmation_options: ['Confirmer', 'Annuler']
    });

    openAIStreamMock.mockImplementationOnce(() =>
      createStream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_suggest_1',
            name: 'comment_assistant',
            args: JSON.stringify({
              mode: 'suggest',
              contextType: 'usecase',
              contextId: useCaseId,
              status: 'open'
            })
          }
        },
        { type: 'done', data: {} }
      ])
    );

    const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
      content: 'Analyse les commentaires',
      primaryContextType: 'usecase',
      primaryContextId: useCaseId,
      model: getTestModel()
    });
    expect(chatResponse.status).toBe(200);
    const chatData = await chatResponse.json();
    assistantMessageIds.push(chatData.assistantMessageId);
    sessionIds.push(chatData.sessionId);

    await waitForJobCompletion(chatData.jobId, user.sessionToken!);

    const streamEventsRes = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/streams/events/${chatData.assistantMessageId}`,
      user.sessionToken!
    );
    expect(streamEventsRes.status).toBe(200);
    const streamData = await streamEventsRes.json();
    const resultEvent = streamData.events.find(
      (e: any) => e.eventType === 'tool_call_result' && e.data?.tool_call_id === 'tool_suggest_1'
    );
    expect(resultEvent).toBeDefined();
    expect(resultEvent.data.result.proposal?.summary_markdown).toBe('Résumé des commentaires.');
  }, 15000);

  it('applies comment_assistant resolve and traces tool_call_id', async () => {
    const threadId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: createId(),
      workspaceId: user.workspaceId!,
      contextType: 'usecase',
      contextId: useCaseId,
      sectionKey: null,
      createdBy: user.id,
      assignedTo: user.id,
      status: 'open',
      threadId,
      content: 'Comment to resolve (close)',
      createdAt: now,
      updatedAt: now
    });

    openAIStreamMock.mockImplementationOnce(() =>
      createStream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_resolve_1',
            name: 'comment_assistant',
            args: JSON.stringify({
              mode: 'resolve',
              contextType: 'usecase',
              contextId: useCaseId,
              confirmation: 'yes',
              actions: [{ thread_id: threadId, action: 'close' }]
            })
          }
        },
        { type: 'done', data: {} }
      ])
    );

    const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
      content: 'Confirmer',
      primaryContextType: 'usecase',
      primaryContextId: useCaseId,
      model: getTestModel()
    });
    expect(chatResponse.status).toBe(200);
    const chatData = await chatResponse.json();
    assistantMessageIds.push(chatData.assistantMessageId);
    sessionIds.push(chatData.sessionId);

    await waitForJobCompletion(chatData.jobId, user.sessionToken!);

    const closedRows = await db
      .select({ status: comments.status })
      .from(comments)
      .where(eq(comments.threadId, threadId));
    expect(closedRows.every((row) => row.status === 'closed')).toBe(true);

    const toolCallRows = await db
      .select({ toolCallId: comments.toolCallId })
      .from(comments)
      .where(eq(comments.toolCallId, 'tool_resolve_1'));
    expect(toolCallRows.length).toBeGreaterThan(0);
  }, 15000);

  it('blocks viewer from resolving comments', async () => {
    const threadId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: createId(),
      workspaceId: user.workspaceId!,
      contextType: 'usecase',
      contextId: useCaseId,
      sectionKey: null,
      createdBy: user.id,
      assignedTo: user.id,
      status: 'open',
      threadId,
      content: 'Viewer should not resolve',
      createdAt: now,
      updatedAt: now
    });

    openAIStreamMock.mockImplementationOnce(() =>
      createStream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_resolve_viewer',
            name: 'comment_assistant',
            args: JSON.stringify({
              mode: 'resolve',
              contextType: 'usecase',
              contextId: useCaseId,
              confirmation: 'yes',
              actions: [{ thread_id: threadId, action: 'close' }]
            })
          }
        },
        { type: 'done', data: {} }
      ])
    );

    const chatResponse = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages?workspace_id=${user.workspaceId}`,
      viewer.sessionToken!,
      {
      content: 'Confirmer',
      primaryContextType: 'usecase',
      primaryContextId: useCaseId,
      model: getTestModel()
      }
    );
    expect(chatResponse.status).toBe(200);
    const chatData = await chatResponse.json();
    assistantMessageIds.push(chatData.assistantMessageId);
    sessionIds.push(chatData.sessionId);

    await waitForJobCompletion(chatData.jobId, viewer.sessionToken!, user.workspaceId);

    const streamEventsRes = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/streams/events/${chatData.assistantMessageId}`,
      viewer.sessionToken!
    );
    expect(streamEventsRes.status).toBe(200);
    const streamData = await streamEventsRes.json();
    const resultEvent = streamData.events.find(
      (e: any) => e.eventType === 'tool_call_result' && e.data?.tool_call_id === 'tool_resolve_viewer'
    );
    expect(resultEvent?.data?.result?.status).toBe('error');

    const stillOpen = await db
      .select({ status: comments.status })
      .from(comments)
      .where(eq(comments.threadId, threadId));
    expect(stillOpen.every((row) => row.status === 'open')).toBe(true);
  }, 15000);

  it('allows admin to resolve threads created by others', async () => {
    const threadId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: createId(),
      workspaceId: user.workspaceId!,
      contextType: 'usecase',
      contextId: useCaseId,
      sectionKey: null,
      createdBy: user.id,
      assignedTo: user.id,
      status: 'open',
      threadId,
      content: 'Admin should resolve',
      createdAt: now,
      updatedAt: now
    });

    openAIStreamMock.mockImplementationOnce(() =>
      createStream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_resolve_admin',
            name: 'comment_assistant',
            args: JSON.stringify({
              mode: 'resolve',
              contextType: 'usecase',
              contextId: useCaseId,
              confirmation: 'yes',
              actions: [{ thread_id: threadId, action: 'close' }]
            })
          }
        },
        { type: 'done', data: {} }
      ])
    );

    const chatResponse = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages?workspace_id=${user.workspaceId}`,
      admin.sessionToken!,
      {
      content: 'Confirmer',
      primaryContextType: 'usecase',
      primaryContextId: useCaseId,
      model: getTestModel()
      }
    );
    expect(chatResponse.status).toBe(200);
    const chatData = await chatResponse.json();
    assistantMessageIds.push(chatData.assistantMessageId);
    sessionIds.push(chatData.sessionId);

    await waitForJobCompletion(chatData.jobId, admin.sessionToken!, user.workspaceId);

    const closedRows = await db
      .select({ status: comments.status })
      .from(comments)
      .where(eq(comments.threadId, threadId));
    expect(closedRows.every((row) => row.status === 'closed')).toBe(true);
  }, 15000);

  it('allows comment_assistant in folder scope to access usecase threads', async () => {
    const threadId = createId();
    const now = new Date();
    await db.insert(comments).values({
      id: createId(),
      workspaceId: user.workspaceId!,
      contextType: 'usecase',
      contextId: otherUseCaseId,
      sectionKey: null,
      createdBy: user.id,
      assignedTo: user.id,
      status: 'open',
      threadId,
      content: 'Folder scope comment',
      createdAt: now,
      updatedAt: now
    });

    proposalMock.mockResolvedValue({
      summary_markdown: 'Résumé des commentaires.',
      actions: [],
      confirmation_prompt: 'Confirmer ?',
      confirmation_options: ['Confirmer', 'Annuler']
    });

    openAIStreamMock.mockImplementationOnce(() =>
      createStream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_folder_scope',
            name: 'comment_assistant',
            args: JSON.stringify({
              mode: 'suggest',
              contextType: 'usecase',
              contextId: otherUseCaseId,
              status: 'open'
            })
          }
        },
        { type: 'done', data: {} }
      ])
    );

    const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
      content: 'Analyse',
      primaryContextType: 'folder',
      primaryContextId: folderId,
      model: getTestModel()
    });
    expect(chatResponse.status).toBe(200);
    const chatData = await chatResponse.json();
    assistantMessageIds.push(chatData.assistantMessageId);
    sessionIds.push(chatData.sessionId);

    await waitForJobCompletion(chatData.jobId, user.sessionToken!);

    const streamEventsRes = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/streams/events/${chatData.assistantMessageId}`,
      user.sessionToken!
    );
    expect(streamEventsRes.status).toBe(200);
    const streamData = await streamEventsRes.json();
    const resultEvent = streamData.events.find(
      (e: any) => e.eventType === 'tool_call_result' && e.data?.tool_call_id === 'tool_folder_scope'
    );
    expect(resultEvent?.data?.result?.status).toBe('completed');
  }, 15000);

  it('rejects comment_assistant outside the allowed usecase scope', async () => {
    openAIStreamMock.mockImplementationOnce(() =>
      createStream([
        {
          type: 'tool_call_start',
          data: {
            tool_call_id: 'tool_wrong_scope',
            name: 'comment_assistant',
            args: JSON.stringify({
              mode: 'suggest',
              contextType: 'usecase',
              contextId: 'uc_invalid',
              status: 'open'
            })
          }
        },
        { type: 'done', data: {} }
      ])
    );

    const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
      content: 'Analyse',
      primaryContextType: 'usecase',
      primaryContextId: useCaseId,
      model: getTestModel()
    });
    expect(chatResponse.status).toBe(200);
    const chatData = await chatResponse.json();
    assistantMessageIds.push(chatData.assistantMessageId);
    sessionIds.push(chatData.sessionId);

    await waitForJobCompletion(chatData.jobId, user.sessionToken!);

    const streamEventsRes = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/streams/events/${chatData.assistantMessageId}`,
      user.sessionToken!
    );
    expect(streamEventsRes.status).toBe(200);
    const streamData = await streamEventsRes.json();
    const resultEvent = streamData.events.find(
      (e: any) => e.eventType === 'tool_call_result' && e.data?.tool_call_id === 'tool_wrong_scope'
    );
    expect(resultEvent?.data?.result?.status).toBe('error');
  }, 15000);
});
