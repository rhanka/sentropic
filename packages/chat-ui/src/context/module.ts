/**
 * module.ts — createContextModule factory (D3).
 *
 * Owns a framework-neutral reactive store of ChatContextEntry[].
 * The factory receives a ContextHost that provides async label resolution,
 * icon resolution, and prefs persistence.
 *
 * NO svelte/store import — uses a minimal hand-rolled writable to stay
 * framework-neutral. The store satisfies the ReadableStore<T> shape from
 * state/chat-context.ts so any Svelte $-prefix auto-subscription works.
 */

import type { ChatContextEntry, ReadableStore } from '../state/chat-context.js';
import {
  toChatRouteContextKey,
  upsertRouteContextEntry,
  selectActiveChatContexts,
} from './context-entry.js';

// ---------------------------------------------------------------------------
// ContextHost contract (D3)
// ---------------------------------------------------------------------------

/**
 * App-side adapter the host must implement.
 *
 * All methods are framework-neutral:
 *   - no Svelte imports
 *   - no DOM dependencies
 *   - async is allowed (network / localStorage)
 */
export type ContextHost = {
  /**
   * Detect the current route context from a route ID + params + optional
   * folder ID. Returns { primaryContextType, primaryContextId? } or null.
   *
   * Called on every route change by updateFromRoute().
   */
  detectContext(input: {
    routeId: string | null | undefined;
    params: Record<string, string | undefined>;
    folderId?: string | null;
  }): { primaryContextType: string; primaryContextId?: string } | null;

  /**
   * Resolve the display label for a context entry.
   *
   * May return synchronously (from an in-memory store) or asynchronously
   * (REST call). The module owns an internal label cache and patches the
   * reactive store once the promise resolves.
   */
  resolveContextLabel(
    type: string,
    id: string,
  ): string | Promise<string>;

  /**
   * Return an icon value for a context type.
   * The return type is `unknown` so the package stays framework-neutral.
   * The app casts to its icon component type.
   */
  iconFor(type: string): unknown;

  /**
   * Load persisted context+tool prefs for a session.
   * Returns raw JSON or null if nothing stored.
   */
  loadPrefs(sessionId: string | null): unknown;

  /**
   * Persist context+tool prefs for a session.
   */
  savePrefs(sessionId: string | null, prefs: unknown): void;
};

// ---------------------------------------------------------------------------
// Minimal hand-rolled writable (no svelte/store)
// ---------------------------------------------------------------------------

type Subscriber<T> = (value: T) => void;
type Unsubscriber = () => void;

type HandWritable<T> = ReadableStore<T> & {
  set(value: T): void;
  update(fn: (current: T) => T): void;
  get(): T;
};

function createWritable<T>(initial: T): HandWritable<T> {
  let current = initial;
  const subscribers = new Set<Subscriber<T>>();

  return {
    subscribe(run: Subscriber<T>, invalidate?: () => void): Unsubscriber {
      subscribers.add(run);
      run(current);
      return () => {
        subscribers.delete(run);
        invalidate?.();
      };
    },
    set(value: T): void {
      current = value;
      for (const sub of subscribers) sub(current);
    },
    update(fn: (c: T) => T): void {
      current = fn(current);
      for (const sub of subscribers) sub(current);
    },
    get(): T {
      return current;
    },
  };
}

// ---------------------------------------------------------------------------
// ContextModule public surface
// ---------------------------------------------------------------------------

export type ContextModule = {
  /** Reactive store — subscribe to get the current ChatContextEntry[]. */
  readonly entries: ReadableStore<ChatContextEntry[]>;

  /**
   * Call when the route changes. Detects the new context via host.detectContext,
   * upserts into the store, and triggers async label resolution if needed.
   */
  updateFromRoute(input: {
    routeId: string | null | undefined;
    params: Record<string, string | undefined>;
    folderId?: string | null;
  }): void;

  /**
   * Mark the current route context as "used" (attached to a chat turn).
   */
  markUsed(input: {
    routeId: string | null | undefined;
    params: Record<string, string | undefined>;
    folderId?: string | null;
  }): void;

  /**
   * Toggle the active state of an entry identified by type + id.
   */
  toggleActive(type: string, id: string | undefined): void;

  /**
   * Load persisted prefs and merge into the store.
   * Returns the raw prefs object for callers that need toolEnabledById etc.
   */
  loadPrefs(sessionId: string | null): unknown;

  /**
   * Persist the current store state + caller-provided extra prefs.
   */
  savePrefs(sessionId: string | null, extra?: Record<string, unknown>): void;

  /**
   * Re-resolve labels for all entries in the store (e.g. after store hydration).
   * Does NOT import svelte/store — safe to call from any framework context.
   */
  refreshLabels(): Promise<void>;

  /**
   * Returns entries that are both active and used (sorted by lastUsedAt desc).
   */
  getActiveContexts(): ChatContextEntry[];
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createContextModule(host: ContextHost): ContextModule {
  const store = createWritable<ChatContextEntry[]>([]);
  const labelCache = new Map<string, string>();
  const labelLoading = new Set<string>();
  let lastRouteKey: string | null = null;

  const resolveAndPatchLabel = (type: string, id: string): void => {
    const key = `${type}:${id}`;
    if (!id || labelCache.has(key) || labelLoading.has(key)) return;
    labelLoading.add(key);

    const result = host.resolveContextLabel(type, id);
    const patch = (label: string) => {
      if (label && label !== id) {
        labelCache.set(key, label);
        store.update((entries) =>
          entries.map((e) =>
            e.type === type && e.id === id ? { ...e, label } : e,
          ),
        );
      }
      labelLoading.delete(key);
    };

    if (typeof result === 'string') {
      patch(result);
    } else {
      result.then(patch).catch(() => labelLoading.delete(key));
    }
  };

  const getBestLabel = (type: string, id: string, fallback: string): string => {
    const key = `${type}:${id}`;
    return labelCache.get(key) || fallback || id;
  };

  const upsert = (input: {
    contextType: string | null | undefined;
    contextId: string | null | undefined;
    used: boolean;
  }): void => {
    const { contextType, contextId } = input;
    const currentLabel =
      contextType && contextId
        ? getBestLabel(contextType, contextId, contextId)
        : '';

    const result = upsertRouteContextEntry({
      entries: store.get(),
      contextType,
      contextId,
      label: currentLabel,
      previousRouteKey: lastRouteKey,
      nowIso: new Date().toISOString(),
      used: input.used,
    });

    store.set(result.entries);
    lastRouteKey = result.nextRouteKey;

    if (result.shouldLoadName && contextType && contextId) {
      resolveAndPatchLabel(contextType, contextId);
    }
  };

  return {
    entries: store,

    updateFromRoute(input) {
      const ctx = host.detectContext(input);
      upsert({
        contextType: ctx?.primaryContextType ?? null,
        contextId: ctx?.primaryContextId ?? null,
        used: false,
      });
    },

    markUsed(input) {
      const ctx = host.detectContext(input);
      if (!ctx?.primaryContextType || !ctx.primaryContextId) return;
      upsert({
        contextType: ctx.primaryContextType,
        contextId: ctx.primaryContextId,
        used: true,
      });
    },

    toggleActive(type, id) {
      store.update((entries) =>
        entries.map((e) => {
          if (e.type !== type || e.id !== id) return e;
          const nextActive = !e.active;
          return {
            ...e,
            active: nextActive,
            lastUsedAt: nextActive ? new Date().toISOString() : e.lastUsedAt,
          };
        }),
      );
    },

    loadPrefs(sessionId) {
      const raw = host.loadPrefs(sessionId);
      if (!raw || typeof raw !== 'object') return raw;
      const parsed = raw as Record<string, unknown>;
      if (Array.isArray(parsed['contexts'])) {
        const entries: ChatContextEntry[] = (parsed['contexts'] as unknown[])
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && 'type' in c)
          .map((c) => ({
            type: String(c['type'] ?? ''),
            id: c['id'] != null ? String(c['id']) : undefined,
            label: String(c['label'] ?? ''),
            active: typeof c['active'] === 'boolean' ? c['active'] : undefined,
            used: typeof c['used'] === 'boolean' ? c['used'] : undefined,
            lastUsedAt: c['lastUsedAt'] != null ? String(c['lastUsedAt']) : undefined,
          }))
          .filter((e) => !!e.type);
        if (entries.length > 0) {
          store.set(entries);
        }
      }
      return raw;
    },

    savePrefs(sessionId, extra) {
      host.savePrefs(sessionId, {
        ...(extra ?? {}),
        contexts: store.get(),
      });
    },

    async refreshLabels() {
      const entries = store.get();
      await Promise.all(
        entries.map(async (e) => {
          if (!e.type || !e.id) return;
          const key = `${e.type}:${e.id}`;
          if (labelCache.has(key)) {
            const label = labelCache.get(key)!;
            if (label !== e.label) {
              store.update((es) =>
                es.map((x) =>
                  x.type === e.type && x.id === e.id ? { ...x, label } : x,
                ),
              );
            }
            return;
          }
          resolveAndPatchLabel(e.type, e.id);
        }),
      );
    },

    getActiveContexts() {
      return selectActiveChatContexts(store.get());
    },
  };
}
