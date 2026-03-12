import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '../../src/db/client';
import {
  chatContexts,
  chatMessages,
  chatSessions,
  users,
  workspaceMemberships,
  workspaces,
} from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import { chatService } from '../../src/services/chat-service';

describe('chat checkpoint runtime', () => {
  let userId = '';
  let workspaceId = '';
  let sessionId = '';
  let messageIds: string[] = [];

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `checkpoint-runtime-${userId}@example.com`,
      displayName: 'Checkpoint Runtime User',
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
      title: 'Checkpoint runtime test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    messageIds = [createId(), createId(), createId(), createId()];
    await db.insert(chatMessages).values([
      {
        id: messageIds[0],
        sessionId,
        role: 'user',
        content: 'Message 1',
        sequence: 1,
        createdAt: new Date(),
      },
      {
        id: messageIds[1],
        sessionId,
        role: 'assistant',
        content: 'Message 2',
        sequence: 2,
        createdAt: new Date(),
      },
      {
        id: messageIds[2],
        sessionId,
        role: 'user',
        content: 'Message 3',
        sequence: 3,
        createdAt: new Date(),
      },
      {
        id: messageIds[3],
        sessionId,
        role: 'assistant',
        content: 'Message 4',
        sequence: 4,
        createdAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(chatContexts).where(eq(chatContexts.sessionId, sessionId));
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
  });

  it('creates and lists checkpoints for a session', async () => {
    const created = await chatService.createCheckpoint({
      sessionId,
      userId,
      title: 'Checkpoint A',
      anchorMessageId: messageIds[1],
    });

    expect(created.title).toBe('Checkpoint A');
    expect(created.anchorMessageId).toBe(messageIds[1]);
    expect(created.anchorSequence).toBe(2);
    expect(created.messageCount).toBe(2);

    const listed = await chatService.listCheckpoints({
      sessionId,
      userId,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.anchorSequence).toBe(2);
  });

  it('restores checkpoint by truncating messages above anchor sequence', async () => {
    const created = await chatService.createCheckpoint({
      sessionId,
      userId,
      title: 'Checkpoint before turn 3',
      anchorMessageId: messageIds[1],
    });

    const restored = await chatService.restoreCheckpoint({
      sessionId,
      checkpointId: created.id,
      userId,
    });

    expect(restored.checkpointId).toBe(created.id);
    expect(restored.restoredToSequence).toBe(2);
    expect(restored.removedMessages).toBe(2);

    const remaining = await db
      .select({
        id: chatMessages.id,
        sequence: chatMessages.sequence,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.sequence));

    expect(remaining).toHaveLength(2);
    expect(remaining.map((row) => row.sequence)).toEqual([1, 2]);
  });
});
