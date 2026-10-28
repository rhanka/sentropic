/**
 * sessionList.ts — pure projection helpers for HTTP-backed session list + history restore.
 *
 * Radar P4 (SPEC_EVOL_CHATUI_WAVE_A §4 P4): fixes "loses history on reload"
 * by projecting `listSessions()` results into a sorted session-list view-model
 * and projecting a session's history payload into a restored timeline.
 *
 * NO app stores, NO Postgres, NO browser API. All functions are pure (node-testable).
 *
 * History projection: @sentropic/chat-core is NOT a direct dependency of
 * @sentropic/chat-ui (not in peerDependencies). This module replicates the
 * minimal types and pure projection needed to drive the view-model. The
 * canonical implementation lives in `@sentropic/chat-core/src/history.ts`
 * (`buildChatHistoryTimeline`); changes to that file should be mirrored here
 * (tracked under the P4 feedback loop).
 */

// ---------------------------------------------------------------------------
// Session list view-model
// ---------------------------------------------------------------------------

/**
 * Shape returned by the HTTP `GET /chat/sessions` endpoint (or equivalent).
 * Mirrors `ChatSessionRow` from @sentropic/chat-core session-port.
 */
export type SessionRow = {
  readonly id: string;
  readonly title?: string | null;
  readonly createdAt: string | Date;
  readonly updatedAt?: string | Date | null;
};

/**
 * Derived view-model for a single entry in the session list.
 *
 * `lastActivity`  — milliseconds since epoch; derived from `updatedAt ?? createdAt`.
 * `displayTitle`  — title falling back to a label-key-resolved default (resolved by the caller).
 */
export type SessionListEntry = {
  /** Session identifier (opaque). */
  readonly id: string;
  /** Human-readable title (may be null — caller resolves the fallback label). */
  readonly title: string | null;
  /** Milliseconds since epoch of the most recent activity. */
  readonly lastActivity: number;
};

/**
 * Project a raw session row array into sorted `SessionListEntry[]`.
 *
 * Sorting: descending by `lastActivity` (most-recently-active first).
 * Pure function — no side effects.
 */
export function projectSessionList(rows: readonly SessionRow[]): SessionListEntry[] {
  return rows
    .map((row): SessionListEntry => ({
      id: row.id,
      title: row.title ?? null,
      lastActivity: toMs(row.updatedAt ?? row.createdAt),
    }))
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

// ---------------------------------------------------------------------------
// History projection view-model
// ---------------------------------------------------------------------------

/**
 * Minimal history message shape — mirrors `ChatHistoryMessage` from
 * @sentropic/chat-core/src/history.ts (pure subset; only fields used here).
 */
export type HistoryMessage = {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content?: string | null;
  readonly createdAt?: string | Date;
  readonly sequence?: number;
};

/**
 * A single restored timeline item — either a user message or an assistant
 * turn (single content string, collapsed from all content_delta events).
 *
 * Intentionally minimal: the host renders using its own StreamMessage /
 * ChatTimeline, not this view-model directly. Extend in later waves if needed.
 */
export type RestoredTimelineItem =
  | {
      readonly kind: 'user-message';
      readonly key: string;
      readonly message: HistoryMessage;
    }
  | {
      readonly kind: 'assistant-message';
      readonly key: string;
      readonly message: HistoryMessage;
      /** Collapsed text content from content_delta events (or message.content fallback). */
      readonly content: string;
    };

/**
 * Shape of the `getHistory` / bootstrap payload items we project from.
 * The bootstrap endpoint returns `{ messages, events }` — this covers the
 * minimal surface we consume.
 */
export type HistoryEventRaw = {
  readonly eventType: string;
  readonly data?: unknown;
  readonly sequence?: number;
};

export type HistoryPayload = {
  /** Ordered message list (oldest first). */
  readonly messages: readonly HistoryMessage[];
  /**
   * Stream events keyed by message id (or `_streamId`).
   * Each value is an array of raw stream events for that assistant turn.
   */
  readonly eventsByMessageId?: Readonly<Record<string, readonly HistoryEventRaw[]>>;
