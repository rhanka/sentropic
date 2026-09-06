import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '../../src/db/client';
import { chatMessages, chatSessions } from '../../src/db/schema';
import { postgresChatMessageStore } from '../../src/services/chat/postgres-chat-message-store';
import { postgresStreamBuffer } from '../../src/services/chat/postgres-stream-buffer';
import { writeChatGenerationTrace } from '../../src/services/chat-trace';
import {
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

/**
 * Regression for the chat persistence write-order FK race.
 *
 * Forensics (docs/uat/2026-06-03-chat-tools-fk-forensics.md): the
 * `chat-tools` AI shard flakes under load with
 *   - `chat_stream_events_message_id_chat_messages_id_fk`
 *   - `chat_generation_traces_session_id_chat_sessions_id_fk`
 *   - `chat_generation_traces_assistant_message_id_chat_messages_id_fk`
 *
 * Mechanism (verified): `chat_sessions.user_id` is `ON DELETE CASCADE`, so the
 * AI-test teardown (`cleanupAuthData` → `db.delete(users)`) cascades to delete
 * the session + assistant message while the generation job is still flushing
 * stream events / generation traces. Any in-flight
 * `postgresStreamBuffer.append(streamId, type, data, seq, messageId)` or
 * `writeChatGenerationTrace(...)` that lands AFTER the parent row is gone throws
 * an unhandled FK violation, which fails the chat job → the shard sees missing
 * tool-call events and times out.
 *
 * The namespace provider keeps these stores canonical. The invariant under
 * test: a stream event / generation trace whose referenced
 * `chat_messages` / `chat_sessions` parent row no longer exists must NOT crash
 * the generation with an unhandled FK violation. The write of an orphaned
 * reference is a no-op (the parent — and by cascade these children — are gone),
 * not a fatal error for the job.
 */
describe('chat namespace canonical persistence write-order FK race', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let sessionId: string;
  let assistantMessageId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    sessionId = createTestId();
    assistantMessageId = createTestId();

    await db.insert(chatSessions).values({
      id: sessionId,
      userId: user.id,
      workspaceId: user.workspaceId ?? null,
      title: 'race repro',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Assistant placeholder row (sequence 2 to mimic user@1 + assistant@2).
    await postgresChatMessageStore.insertMany([
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        toolCalls: null,
        toolCallId: null,
        reasoning: null,
        model: 'test-model',
        promptId: null,
        promptVersionId: null,
        sequence: 2,
        createdAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    // Best-effort: rows may already be gone via the simulated cascade.
    await db.delete(chatMessages).where(eq(chatMessages.id, assistantMessageId));
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    await cleanupAuthData();
  });

  it('does not crash when a stream event references an already-deleted assistant message', async () => {
    // First append while the parent exists — must succeed (streamId === messageId).
    await expect(
      postgresStreamBuffer.append(
        assistantMessageId,
        'status',
        { state: 'started' },
        1,
        assistantMessageId,
      ),
    ).resolves.toBeDefined();

    // Simulate the teardown cascade: deleting the session cascades to
    // chat_messages → chat_stream_events. The assistant row is now gone.
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

    const survivor = await postgresChatMessageStore.findById(assistantMessageId);
    expect(survivor).toBeNull(); // confirm the parent is truly gone

    // An in-flight append landing after the cascade references a now-absent
    // chat_messages row. It must NOT throw an FK violation that would crash the
    // generation job. Today it throws
    // `chat_stream_events_message_id_chat_messages_id_fk`.
    await expect(
      postgresStreamBuffer.append(
        assistantMessageId,
        'content_delta',
        { delta: 'late chunk' },
        2,
        assistantMessageId,
      ),
    ).resolves.not.toThrow();
  });

  it('does not crash when a generation trace references an already-deleted session/message', async () => {
    // Trace while the parent exists — must succeed.
    await expect(
      writeChatGenerationTrace({
        enabled: true,
        sessionId,
        assistantMessageId,
        userId: user.id,
        workspaceId: user.workspaceId ?? null,
        phase: 'pass1',
        iteration: 1,
        model: 'test-model',
        toolChoice: 'auto',
        tools: null,
        openaiMessages: { kind: 'executed_tools', messages: [] },
        toolCalls: null,
        meta: { kind: 'executed_tools' },
      }),
    ).resolves.not.toThrow();

    // Simulate the teardown cascade (session → messages → traces gone).
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

    // An in-flight trace landing after the cascade references now-absent
    // chat_sessions + chat_messages rows. It must NOT throw the FK violation
    // `chat_generation_traces_session_id_chat_sessions_id_fk`.
    await expect(
      writeChatGenerationTrace({
        enabled: true,
        sessionId,
        assistantMessageId,
        userId: user.id,
        workspaceId: user.workspaceId ?? null,
        phase: 'pass2',
        iteration: 1,
        model: 'test-model',
        toolChoice: 'none',
        tools: null,
        openaiMessages: { kind: 'pass2_prompt', messages: [] },
        toolCalls: null,
        meta: { kind: 'pass2_prompt' },
      }),
    ).resolves.not.toThrow();
  });
});
