/**
 * context-entry.ts — Generic, domain-neutral context entry helpers.
 *
 * All types use open strings — no domain-specific values.
 * Route detection, entity lookup, and icon resolution stay app-owned.
 */

import type { ChatContextEntry } from '../state/chat-context.js';

/**
 * Returns a stable string key for a context entry or route context.
 * Returns null for entries without both type and id.
 */
export const toChatRouteContextKey = (
  entry: { type?: string; id?: string } | null | undefined,
): string | null => {
  if (!entry) return null;
  return entry.type && entry.id ? `${entry.type}:${entry.id}` : null;
};

/**
 * Generic upsert: given an existing entries array and an incoming route context
 * (type + id, resolved label, and metadata), returns a new entries array with
 * the entry added or updated, plus the next route key and a flag indicating
 * whether a label load is needed.
 *
 * All values are pure — no side effects, no network calls.
 */
export const upsertRouteContextEntry = (input: {
  entries: readonly ChatContextEntry[];
  contextType: string | null | undefined;
  contextId: string | null | undefined;
  label: string;
  previousRouteKey: string | null;
  nowIso: string;
  used: boolean;
}): {
  entries: ChatContextEntry[];
  nextRouteKey: string | null;
  shouldLoadName: boolean;
} => {
  const { contextType, contextId } = input;
  const nextRouteKey =
    contextType && contextId ? `${contextType}:${contextId}` : null;

  let entries = [...input.entries];

  // Remove the previous route entry if unused and the route changed.
  if (input.previousRouteKey && input.previousRouteKey !== nextRouteKey) {
    entries = entries.filter(
      (entry) =>
        !(toChatRouteContextKey(entry) === input.previousRouteKey && !entry.used),
    );
  }

  if (!contextType || !contextId) {
    return { entries, nextRouteKey, shouldLoadName: false };
  }

  const label = input.label || contextId;
  const index = entries.findIndex(
    (entry) => entry.type === contextType && entry.id === contextId,
  );

  if (index === -1) {
    entries = [
      {
        type: contextType,
        id: contextId,
        label,
        active: true,
        used: input.used,
        lastUsedAt: input.used ? input.nowIso : undefined,
      },
      ...entries,
    ];
  } else {
    const current = entries[index];
    entries = [...entries];
    entries[index] = {
      ...current,
      label,
      active: true,
      used: input.used ? true : current.used,
      lastUsedAt: input.used ? input.nowIso : current.lastUsedAt,
    };
  }

  return {
    entries,
    nextRouteKey,
    shouldLoadName: label === contextId,
  };
};

/**
 * Returns entries that are both active and used, sorted by lastUsedAt descending.
 */
export const selectActiveChatContexts = (
  entries: readonly ChatContextEntry[],
): ChatContextEntry[] =>
  entries
    .filter((entry) => entry.active && entry.used)
    .sort((a, b) => {
      const ta = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const tb = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      return tb - ta;
    });
