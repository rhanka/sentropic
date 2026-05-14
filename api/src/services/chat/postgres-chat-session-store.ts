import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { chatSessions } from '../../db/schema';
import { createId } from '../../utils/id';
import type {
  ChatSessionRow,
  CreateSessionInput,
  SessionContextUpdate,
  SessionStore,
} from '../../../../packages/chat-core/src/session-port';

/**
 * Per SPEC §5 — PostgresChatSessionStore implements SessionStore over Drizzle.
 *
 * BR14b Lot 8 — first real extraction of chat-session persistence from
 * chat-service.ts. Methods carry the VERBATIM SQL/Drizzle logic that
 * previously lived inline in ChatService.* (getSessionForUser, createSession,
 * listSessions, deleteSession, plus the four targeted writes:
 * - touch updatedAt on edit/retry user message, on send message, on assistant
 *   message final update, and on finalizeAssistantMessageFromStream;
 * - update primaryContextType/primaryContextId during sendMessage when the
 *   context differs from the existing row;
 * - update title after sendMessage when the title generator produced a
 *   non-empty value).
 *
 * Caller (ChatService) preserves all orchestration concerns (workspace
 * resolution, todoRuntime, title generation, workspace-event notification,
 * stream events, model selection). This adapter is persistence-only.
 *
 * Tenant scoping: `findForUser`, `listForUser`, `deleteForUser` retain the
 * `(id, userId)` / `(userId)` predicates verbatim. `listForUser` performs
 * the same `workspaceId` trim+empty-string normalisation that lived in
 * `ChatService.listSessions` pre BR14b Lot 8.
 */
export class PostgresChatSessionStore implements SessionStore {
  async findForUser(
    sessionId: string,
    userId: string,
  ): Promise<ChatSessionRow | null> {
    const [row] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
    return (row as ChatSessionRow | undefined) ?? null;
  }

  async listForUser(
    userId: string,
    workspaceId?: string | null,
  ): Promise<ChatSessionRow[]> {
    const normalizedWorkspaceId =
      typeof workspaceId === 'string' && workspaceId.trim().length > 0
        ? workspaceId.trim()
        : null;
    const rows = await db
      .select()
      .from(chatSessions)
      .where(
        normalizedWorkspaceId
          ? and(
              eq(chatSessions.userId, userId),
              eq(chatSessions.workspaceId, normalizedWorkspaceId),
            )
          : eq(chatSessions.userId, userId),
      )
      .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.createdAt));
    return rows as ChatSessionRow[];
  }

  async create(input: CreateSessionInput): Promise<{ sessionId: string }> {
    const sessionId = createId();
    await db.insert(chatSessions).values({
      id: sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      primaryContextType: input.primaryContextType ?? null,
      primaryContextId: input.primaryContextId ?? null,
      title: input.title ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { sessionId };
  }

  async deleteForUser(sessionId: string, userId: string): Promise<void> {
    await db
      .delete(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
  }

  async touchUpdatedAt(sessionId: string): Promise<void> {
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }

  async updateContext(
    sessionId: string,
    update: SessionContextUpdate,
  ): Promise<void> {
    await db
      .update(chatSessions)
      .set({
        primaryContextType: update.primaryContextType,
        primaryContextId: update.primaryContextId,
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, sessionId));
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    await db
      .update(chatSessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }
}

export const postgresChatSessionStore = new PostgresChatSessionStore();
