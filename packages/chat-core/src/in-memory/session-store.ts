/**
 * BR14b Lot 15.5 — InMemorySessionStore.
 *
 * Reference in-memory adapter for the `SessionStore` port. Mandated by
 * SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5: every chat-core port ships with
 * an in-memory adapter so downstream consumers and unit tests can use the
 * runtime without any Postgres dependency.
 *
 * Behavior mirrors `PostgresChatSessionStore` including the
 * `workspaceId` trim+empty-string normalisation that lives in
 * `listForUser`.
 */
import type {
  ChatSessionRow,
  CreateSessionInput,
  SessionContextUpdate,
  SessionStore,
} from '../session-port.js';

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `mem-session-${counter}-${Date.now().toString(36)}`;
};

export class InMemorySessionStore implements SessionStore {
  private rows = new Map<string, ChatSessionRow>();

  /** Test helper — wipe all internal state. */
  reset(): void {
    this.rows.clear();
  }

  /** Test helper — return the raw rows by id (no defensive copy). */
  snapshot(): ChatSessionRow[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  /** Test helper — direct insert (for tests that pre-seed sessions). */
  seed(row: ChatSessionRow): void {
    this.rows.set(row.id, { ...row });
  }

  async findForUser(
    sessionId: string,
    userId: string,
  ): Promise<ChatSessionRow | null> {
    const row = this.rows.get(sessionId);
    if (!row || row.userId !== userId) return null;
    return { ...row };
  }

  async listForUser(
    userId: string,
    workspaceId?: string | null,
  ): Promise<ChatSessionRow[]> {
    const normalizedWorkspaceId =
      typeof workspaceId === 'string' && workspaceId.trim().length > 0
        ? workspaceId.trim()
        : null;
    const filtered = [...this.rows.values()].filter((row) => {
      if (row.userId !== userId) return false;
      if (normalizedWorkspaceId === null) return true;
      return row.workspaceId === normalizedWorkspaceId;
    });
    return filtered
      .sort((a, b) => {
        const aUpdated = a.updatedAt
          ? new Date(a.updatedAt as string).getTime()
          : 0;
        const bUpdated = b.updatedAt
          ? new Date(b.updatedAt as string).getTime()
          : 0;
        if (aUpdated !== bUpdated) return bUpdated - aUpdated;
        const aCreated = new Date(a.createdAt as string).getTime();
        const bCreated = new Date(b.createdAt as string).getTime();
        return bCreated - aCreated;
      })
      .map((row) => ({ ...row }));
  }

  async create(input: CreateSessionInput): Promise<{ sessionId: string }> {
    const sessionId = nextId();
    const now = new Date();
    this.rows.set(sessionId, {
      id: sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      primaryContextType: input.primaryContextType ?? null,
      primaryContextId: input.primaryContextId ?? null,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return { sessionId };
  }

  async deleteForUser(sessionId: string, userId: string): Promise<void> {
    const row = this.rows.get(sessionId);
    if (!row || row.userId !== userId) return;
    this.rows.delete(sessionId);
  }

  async touchUpdatedAt(sessionId: string): Promise<void> {
    const row = this.rows.get(sessionId);
    if (!row) return;
    this.rows.set(sessionId, { ...row, updatedAt: new Date() });
  }

  async updateContext(
    sessionId: string,
    update: SessionContextUpdate,
  ): Promise<void> {
    const row = this.rows.get(sessionId);
    if (!row) return;
    this.rows.set(sessionId, {
      ...row,
      primaryContextType: update.primaryContextType,
      primaryContextId: update.primaryContextId,
      updatedAt: new Date(),
    });
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    const row = this.rows.get(sessionId);
    if (!row) return;
    this.rows.set(sessionId, { ...row, title, updatedAt: new Date() });
  }
}
