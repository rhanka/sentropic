import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { chatMessages, jobQueue } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import { writeStreamEvent } from '../../src/services/stream-service';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

type SseEvent = { event?: string; data?: any; raw?: string };
type OpenSse = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const complete = parts.slice(0, -1);
  const rest = parts[parts.length - 1] ?? '';
  const events: SseEvent[] = [];

  for (const chunk of complete) {
    const lines = chunk.split('\n').filter(Boolean);
    let event: string | undefined;
    let dataLine: string | undefined;

    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
    }

    let data: any = undefined;
    if (dataLine) {
      try {
        data = JSON.parse(dataLine);
      } catch {
        data = dataLine;
      }
    }

    events.push({ event, data, raw: chunk });
  }

  return { events, rest };
}

async function openSse(sessionToken: string, path: string): Promise<OpenSse> {
  const response = await app.request(path, {
    headers: { cookie: `session=${sessionToken}` },
  });
  expect(response.status).toBe(200);
  expect(response.body).toBeTruthy();

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const first = await Promise.race([reader.read(), sleep(500)]);
  const buffer =
    first && typeof (first as any).done === 'boolean' && !(first as ReadableStreamReadResult<Uint8Array>).done
      ? decoder.decode((first as ReadableStreamReadResult<Uint8Array>).value, { stream: true })
      : '';

  return { reader, buffer };
}

async function collectFor(opened: OpenSse, ms: number): Promise<SseEvent[]> {
  const end = Date.now() + ms;
  const decoder = new TextDecoder();
  let buffer = opened.buffer;
  const output: SseEvent[] = [];

  const initial = parseSse(buffer);
  buffer = initial.rest;
  output.push(...initial.events);

  while (Date.now() < end) {
    const remaining = end - Date.now();
    const result = await Promise.race([opened.reader.read(), sleep(remaining)]);
    if (!result || typeof (result as any).done !== 'boolean') break;
    const read = result as ReadableStreamReadResult<Uint8Array>;
    if (read.done) break;

    buffer += decoder.decode(read.value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    output.push(...parsed.events);
  }

  return output;
}

function parseJobData(value: unknown): Record<string, any> {
  return typeof value === 'string' ? JSON.parse(value) : (value as Record<string, any>);
}

describe('chat API characterization contract', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;
  let createdJobIds: string[];

  beforeEach(async () => {
    createdJobIds = [];
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (createdJobIds.length > 0) {
      await db.delete(jobQueue).where(inArray(jobQueue.id, createdJobIds));
    }
    await cleanupAuthData();
    processJobsSpy.mockRestore();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it('preserves app-contract message creation, SSE replay, messages and bootstrap payloads', async () => {
    const create = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        content: 'Characterize current chat wire contract',
        contexts: [{ contextType: 'organization', contextId: 'org_contract' }],
      },
    );
    expect(create.status).toBe(200);
    const created = await create.json();
    createdJobIds.push(String(created.jobId));

    expect(created).toEqual({
      sessionId: expect.any(String),
      userMessageId: expect.any(String),
      assistantMessageId: expect.any(String),
      streamId: created.assistantMessageId,
      jobId: expect.any(String),
    });

    const [job] = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, String(created.jobId)))
      .limit(1);
    expect(job?.type).toBe('chat_message');
    expect(job?.workspaceId).toBe(user.workspaceId);
    expect(parseJobData(job!.data)).toEqual(
      expect.objectContaining({
        userId: user.id,
        sessionId: created.sessionId,
        assistantMessageId: created.assistantMessageId,
        contexts: [{ contextType: 'organization', contextId: 'org_contract' }],
      }),
    );

    await writeStreamEvent(
      created.assistantMessageId,
      'content_delta',
      { delta: 'Hello' },
      1,
      created.assistantMessageId,
    );
    await writeStreamEvent(
      created.assistantMessageId,
      'content_delta',
      { delta: ' world' },
      2,
      created.assistantMessageId,
    );
    await writeStreamEvent(
      created.assistantMessageId,
      'done',
      {},
      3,
      created.assistantMessageId,
    );

    const sse = await openSse(
      user.sessionToken!,
      `/api/v1/streams/sse?streamIds=${encodeURIComponent(created.assistantMessageId)}`,
    );
    const events = await collectFor(sse, 500);
    await sse.reader.cancel();

    const replayed = events
      .filter((event) => event.event === 'content_delta' || event.event === 'done')
      .map((event) => ({
        event: event.event,
        streamId: event.data?.streamId,
        sequence: event.data?.sequence,
        data: event.data?.data,
      }));
    expect(replayed).toEqual([
      {
        event: 'content_delta',
        streamId: created.assistantMessageId,
        sequence: 1,
        data: { delta: 'Hello' },
      },
      {
        event: 'content_delta',
        streamId: created.assistantMessageId,
        sequence: 2,
        data: { delta: ' world' },
      },
      {
        event: 'done',
        streamId: created.assistantMessageId,
        sequence: 3,
        data: {},
      },
    ]);

    const runtimeDetails = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/messages/${created.assistantMessageId}/runtime-details`,
      user.sessionToken!,
    );
    expect(runtimeDetails.status).toBe(200);
    const runtimeItems = (await runtimeDetails.json()).items;
    expect(runtimeItems).toHaveLength(1);
    expect(runtimeItems[0]).toMatchObject({
      kind: 'assistant-segment',
      isTerminal: true,
      segment: {
        kind: 'assistant',
        content: 'Hello world',
        events: [
          expect.objectContaining({ eventType: 'content_delta', sequence: 1 }),
          expect.objectContaining({ eventType: 'content_delta', sequence: 2 }),
        ],
      },
    });

    const messages = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${created.sessionId}/messages`,
      user.sessionToken!,
    );
    expect(messages.status).toBe(200);
    const messagesBody = await messages.json();
    expect(messagesBody.sessionId).toBe(created.sessionId);
    expect(messagesBody.messages).toEqual([
      expect.objectContaining({
        id: created.userMessageId,
        role: 'user',
        content: 'Characterize current chat wire contract',
        sequence: 1,
        contexts: [{ contextType: 'organization', contextId: 'org_contract' }],
      }),
      expect.objectContaining({
        id: created.assistantMessageId,
        role: 'assistant',
        sequence: 2,
      }),
    ]);

    const bootstrap = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${created.sessionId}/bootstrap`,
      user.sessionToken!,
    );
    expect(bootstrap.status).toBe(200);
    const bootstrapBody = await bootstrap.json();
    expect(bootstrapBody.sessionId).toBe(created.sessionId);
    expect(bootstrapBody.assistantDetailsByMessageId[created.assistantMessageId]).toEqual([
      expect.objectContaining({ eventType: 'content_delta', sequence: 1 }),
      expect.objectContaining({ eventType: 'content_delta', sequence: 2 }),
      expect.objectContaining({ eventType: 'done', sequence: 3 }),
    ]);

    const stop = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/stop`,
      user.sessionToken!,
      {},
    );
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({ ok: true, jobId: created.jobId });

    const feedback = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/feedback`,
      user.sessionToken!,
      { vote: 'up' },
    );
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toEqual({
      messageId: created.assistantMessageId,
      vote: 1,
    });
  });

  it('preserves steer, retry and checkpoint route payloads', async () => {
    const first = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      { content: 'Checkpoint baseline #1' },
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    createdJobIds.push(String(firstBody.jobId));

    const steer = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${firstBody.assistantMessageId}/steer`,
      user.sessionToken!,
      {
        message: 'Keep the answer focused on migration risk.',
        metadata: { source: 'characterization' },
      },
    );
    expect(steer.status).toBe(200);
    expect(await steer.json()).toEqual({
      assistantMessageId: firstBody.assistantMessageId,
      status: 'accepted',
      action: 'interrupt_relaunch',
      steer: expect.objectContaining({
        messageId: expect.any(String),
        message: 'Keep the answer focused on migration risk.',
        metadata: { source: 'characterization' },
      }),
    });

    const checkpoint = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/sessions/${firstBody.sessionId}/checkpoints`,
      user.sessionToken!,
      { title: 'Before retry characterization' },
    );
    expect(checkpoint.status).toBe(200);
    const checkpointBody = await checkpoint.json();
    const checkpointId = String(checkpointBody.checkpoint.id);
    expect(checkpointBody).toEqual({
      sessionId: firstBody.sessionId,
      checkpoint: expect.objectContaining({
        id: expect.any(String),
        title: 'Before retry characterization',
      }),
    });

    const second = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        sessionId: firstBody.sessionId,
        content: 'Checkpoint baseline #2',
      },
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    createdJobIds.push(String(secondBody.jobId));
    expect(secondBody.sessionId).toBe(firstBody.sessionId);

    const listCheckpoints = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${firstBody.sessionId}/checkpoints`,
      user.sessionToken!,
    );
    expect(listCheckpoints.status).toBe(200);
    const listed = await listCheckpoints.json();
    expect(listed.checkpoints.map((item: any) => item.id)).toContain(checkpointId);

    const restore = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/sessions/${firstBody.sessionId}/checkpoints/${checkpointId}/restore`,
      user.sessionToken!,
      {},
    );
    expect(restore.status).toBe(200);
    expect(await restore.json()).toEqual(
      expect.objectContaining({
        sessionId: firstBody.sessionId,
        checkpointId,
        restoredToSequence: expect.any(Number),
        removedMessages: expect.any(Number),
      }),
    );

    const retry = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${firstBody.userMessageId}/retry`,
      user.sessionToken!,
      {
        model: 'gemini-2.5-flash-lite',
        vscodeCodeAgent: {
          source: 'vscode',
          workspaceKey: '/repo',
          workspaceLabel: 'repo',
          promptWorkspaceOverride: 'Use the workspace rules.',
        },
      },
    );
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    createdJobIds.push(String(retryBody.jobId));
    expect(retryBody).toEqual({
      sessionId: firstBody.sessionId,
      userMessageId: firstBody.userMessageId,
      assistantMessageId: expect.any(String),
      streamId: retryBody.assistantMessageId,
      jobId: expect.any(String),
    });

    const [retriedAssistant] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, retryBody.assistantMessageId))
      .limit(1);
    expect(retriedAssistant?.model).toBe('gemini-3.1-flash-lite');
  });

  it('preserves local tool-result resume semantics and queued payload shape', async () => {
    const create = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      { content: 'Await local browser tool result' },
    );
    expect(create.status).toBe(200);
    const created = await create.json();
    createdJobIds.push(String(created.jobId));

    await writeStreamEvent(
      created.assistantMessageId,
      'status',
      {
        state: 'awaiting_local_tool_results',
        previous_response_id: 'resp_contract_1',
        pending_local_tool_calls: [
          {
            tool_call_id: 'call_local_1',
            name: 'tab_read',
            args: { mode: 'active' },
          },
        ],
        base_tool_outputs: [
          {
            call_id: 'call_server_1',
            output: '{"ok":true}',
            name: 'history_analyze',
            args: { scope: 'session' },
          },
        ],
        local_tool_definitions: [
          {
            name: 'tab_read',
            description: 'Read the active browser tab',
            parameters: {
              type: 'object',
              properties: { mode: { type: 'string' } },
              required: ['mode'],
            },
          },
        ],
      },
      1,
      created.assistantMessageId,
    );

    const toolResult = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/tool-results`,
      user.sessionToken!,
      {
        toolCallId: 'call_local_1',
        result: { title: 'Sentropic workspace', status: 'completed' },
      },
    );
    expect(toolResult.status).toBe(200);
    const toolResultBody = await toolResult.json();
    createdJobIds.push(String(toolResultBody.jobId));
    expect(toolResultBody).toEqual({
      ok: true,
      accepted: true,
      resumed: true,
      jobId: expect.any(String),
    });

    const [resumeJob] = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, toolResultBody.jobId))
      .limit(1);
    expect(resumeJob?.type).toBe('chat_message');
    expect(parseJobData(resumeJob!.data)).toEqual(
      expect.objectContaining({
        userId: user.id,
        sessionId: created.sessionId,
        assistantMessageId: created.assistantMessageId,
        localToolDefinitions: [
          expect.objectContaining({
            name: 'tab_read',
            description: 'Read the active browser tab',
          }),
        ],
        resumeFrom: {
          previousResponseId: 'resp_contract_1',
          toolOutputs: [
            expect.objectContaining({
              callId: 'call_server_1',
              output: '{"ok":true}',
            }),
            expect.objectContaining({
              callId: 'call_local_1',
              name: 'tab_read',
              args: { mode: 'active' },
            }),
          ],
        },
      }),
    );
  });
});
