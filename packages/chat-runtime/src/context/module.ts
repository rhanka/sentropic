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
