import { readAppContractStreamEvents, type ChatStreamPort } from '@sentropic/chat-server';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { chatMessages, chatSessions } from '../../db/schema';
import { listActiveStreamIds, readStreamEvents } from '../../services/stream-service';
import type { StreamsChatPort, StreamsOutboxPort } from './streams-ports';

export const productStreamsOutboxPort: StreamsOutboxPort = {
  listActive: (input) => listActiveStreamIds(input),
  read: ({ streamId, sinceSequence }) => readStreamEvents(streamId, sinceSequence),
  async readOne({ streamId, sequence }) {
    const row = await db.get(sql`
      SELECT stream_id AS "streamId", event_type AS "eventType", data, sequence
      FROM chat_stream_events
      WHERE stream_id = ${streamId} AND sequence = ${sequence}
    `) as { streamId?: string; eventType?: string; data?: unknown; sequence?: number } | undefined;
    return row?.streamId && row.eventType && typeof row.sequence === 'number'
      ? { streamId: row.streamId, eventType: row.eventType, data: row.data, sequence: row.sequence }
      : null;
  },
};

export const productStreamsChatPort: StreamsChatPort = {
  async read({ streamId, sinceSequence, principal, targetWorkspaceId }) {
    const isStreamAllowed = async (): Promise<boolean> => {
      const [row] = await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .leftJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
        .where(and(eq(chatMessages.id, streamId), eq(chatSessions.userId, principal.userId)))
        .limit(1);
      return !!row;
    };
    const stream: ChatStreamPort = {
      readSessionEvents: async () => [],
      readStreamEvents: (input) => readStreamEvents(input.streamId, input.sinceSequence),
      isStreamAllowed,
    };
    return readAppContractStreamEvents(stream, {
      streamId,
      userId: principal.userId,
      workspaceId: targetWorkspaceId,
      sinceSequence,
    });
  },
};
