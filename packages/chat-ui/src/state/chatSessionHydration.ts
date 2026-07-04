/**
 * Session-history hydration helpers (gold shell S1b).
 *
 * Pure, framework-neutral pieces of the progressive session hydration the
 * sentropic panel performs when switching conversations: the NDJSON stream is
 * read line by line (end-of-conversation first), staged until a first
 * viewport-sized batch is ready, then the previous session is cleared and the
 * new one revealed at the bottom in one atomic swap (anti-flash, BUG-L6-44).
 *
 * DOM reads (viewport/staged heights), scroll restoration and the controller
 * swap stay host-side; hosts inject measurements and drive the protocol with
 * these helpers. Usable from Svelte/React/Angular/Vue views alike.
 */
import type { ChatProjectedTimelineItem } from './chatProjection.js';

export type SessionHistoryMetaLine = {
  type: 'session_meta';
  sessionId: string;
  title?: string | null;
  todoRuntime?: Record<string, unknown> | null;
  checkpoints?: unknown[];
  documents?: unknown[];
};

export type SessionHistoryTimelineLine<
  Item extends ChatProjectedTimelineItem = ChatProjectedTimelineItem,
> = {
  type: 'timeline_item';
  item: Item;
};

export type SessionHistoryLine<
  Item extends ChatProjectedTimelineItem = ChatProjectedTimelineItem,
> = SessionHistoryMetaLine | SessionHistoryTimelineLine<Item>;

/**
 * Parses one raw NDJSON line. Blank lines resolve to `null`; malformed JSON
 * throws (the hydration driver surfaces it as a load error, same as today).
 */
export const parseSessionHistoryLine = <
  Item extends ChatProjectedTimelineItem = ChatProjectedTimelineItem,
>(
  rawLine: string,
): SessionHistoryLine<Item> | null => {
  const line = rawLine.trim();
  if (!line) return null;
  return JSON.parse(line) as SessionHistoryLine<Item>;
};

/**
 * Incremental NDJSON splitter over a byte stream: `push` yields every
 * complete line in the chunk, `flush` returns the trailing partial line (if
 * any) once the stream is done.
 */
export const createNdjsonSplitter = () => {
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    push(chunk: Uint8Array): string[] {
      buffer += decoder.decode(chunk, { stream: true });
      const lines: string[] = [];
      let boundary = buffer.indexOf('\n');
      while (boundary >= 0) {
        lines.push(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf('\n');
      }
      return lines;
    },
    flush(): string | null {
      buffer += decoder.decode();
      const rest = buffer;
      buffer = '';
      return rest.trim().length > 0 ? rest : null;
    },
  };
};

/**
 * Hydration generation guard: a later `begin()` (or `invalidate()`, e.g. on
 * "new session") makes every older token stale so an in-flight hydration
 * stops applying its batches.
 */
export const createHydrationGenerations = () => {
  let generation = 0;
  return {
    begin() {
      const current = ++generation;
      return { generation: current, isCurrent: () => current === generation };
    },
    invalidate() {
      generation += 1;
    },
  };
};

/**
 * First-batch flush predicate: flush once the staged block outgrows the
 * viewport. Measurements are host-injected (DOM reads stay in the view).
 */
export const shouldFlushHistoryStage = (input: {
  stagedCount: number;
  stagedHeight: number;
  viewportHeight: number;
}): boolean => {
  if (input.stagedCount === 0) return false;
  if (!Number.isFinite(input.viewportHeight) || input.viewportHeight <= 0) {
    return false;
  }
  return input.stagedHeight > input.viewportHeight;
};

/**
 * Hydrated-message normalization: history messages default their stream id to
 * the message id, and messages that already carry content are terminal.
 */
export const normalizeHydratedMessage = <
  M extends {
    id: string;
    content?: string | null;
    _streamId?: string;
    _localStatus?: string;
  },
>(
  message: M,
): M => ({
  ...message,
  _streamId: message._streamId ?? message.id,
  _localStatus:
    message._localStatus ?? (message.content ? 'completed' : undefined),
});

/**
 * Sequence-ordered upsert: an existing message (by id) is merged in place;
 * a new one is inserted keeping ascending `sequence` order (stable from the
 * end, as hydration streams end-of-conversation first).
 */
export const upsertSequencedMessage = <
  M extends { id: string; sequence?: number | string | null },
>(
  messages: readonly M[],
  message: M,
): M[] => {
  const next = [...messages];
  const existingIndex = next.findIndex((entry) => entry.id === message.id);
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], ...message };
    return next;
  }
  const sequence = Number(message.sequence ?? 0);
  let insertAt = next.length;
  while (
    insertAt > 0 &&
    Number(next[insertAt - 1]?.sequence ?? 0) > sequence
  ) {
    insertAt -= 1;
  }
  next.splice(insertAt, 0, message);
  return next;
};
