/**
 * Per SPEC §5 — chat-core SessionStore port.
 * Owns chat-session persistence (find/create/list/delete + targeted updates:
 * touch, context, title) independently of the orchestration concerns that
 * remain in `chat-service.ts` (workspace resolution, title generation,
 * workspace-event notification, todo runtime, etc.).
 *
 * Isolated from `./ports.ts` (which pulls @sentropic/contracts and
 * @sentropic/events) so that downstream packages can consume the
 * SessionStore surface without the full chat-core dependency closure.
 * Mirrors the isolation pattern established in `./checkpoint-port.ts`
 * (BR14b Lot 4), `./message-port.ts` (BR14b Lot 6), and `./stream-port.ts`
 * (BR14b Lot 7): pre BR14b wiring of contracts/events into the api
 * Dockerfile, this isolation lets the api workspace import the port via
 * relative path.
 *
 * Field set mirrors the `chat_sessions` table verbatim (id, userId,
 * workspaceId, primaryContextType, primaryContextId, title, createdAt,
 * updatedAt). All read methods that take `userId` enforce the session
 * owner tenant scoping that lived inline in chat-service.ts pre BR14b Lot 8.
 */
export type ChatSessionRow = {
  readonly id: string;
  readonly userId: string;
  readonly workspaceId: string | null;
  readonly primaryContextType: string | null;
  readonly primaryContextId: string | null;
  readonly title: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string | null;
};

export type CreateSessionInput = {
  readonly userId: string;
  readonly workspaceId?: string | null;
  readonly primaryContextType?: string | null;
  readonly primaryContextId?: string | null;
  readonly title?: string | null;
};

export type SessionContextUpdate = {
  readonly primaryContextType: string;
  readonly primaryContextId: string;
};

/**
 * SessionStore port — contracts-free surface for chat-session persistence.
 *
 * - `findForUser` enforces (id, userId) authz join.
 * - `listForUser` accepts an optional workspaceId scope; trim+empty-string
 *   normalisation happens INSIDE the adapter (preserves pre BR14b Lot 8
 *   behavior).
 * - `deleteForUser` performs the (id, userId) scoped delete. The caller is
 *   responsible for the existence precheck used to throw `Session not
 *   found` — this preserves the legacy ChatService.deleteSession contract.
 * - `touchUpdatedAt`, `updateContext`, `updateTitle` are targeted writes
 *   used by chat-service orchestration paths (edit/retry message, sending
 *   message with new context, post-generation title generation, assistant
 *   message finalisation).
 */
export interface SessionStore {
  // Reads
  findForUser(sessionId: string, userId: string): Promise<ChatSessionRow | null>;

  listForUser(
    userId: string,
    workspaceId?: string | null,
  ): Promise<ChatSessionRow[]>;

  // Writes — lifecycle
  create(input: CreateSessionInput): Promise<{ sessionId: string }>;

  deleteForUser(sessionId: string, userId: string): Promise<void>;

  // Writes — targeted updates
  touchUpdatedAt(sessionId: string): Promise<void>;

  updateContext(sessionId: string, update: SessionContextUpdate): Promise<void>;

  updateTitle(sessionId: string, title: string): Promise<void>;
}
