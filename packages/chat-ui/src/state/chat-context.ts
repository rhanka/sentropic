/**
 * chat-context.ts — domain-neutral ChatContextProvider port.
 *
 * Published as part of @sentropic/chat-ui (radar P3 from SPEC_EVOL_CHATUI_WAVE_A §4).
 *
 * Contract:
 * - `ChatContextEntry`: a single already-resolved context chip; no route parsing
 *   or entity lookup — the app/host populates and resolves labels before passing.
 * - `ChatContextProvider`: exposes a Svelte-store-compatible `Readable<ChatContextEntry[]>`.
 * - `createNoopChatContextProvider()`: returns an empty-list provider for hosts that
 *   have not yet wired up context, or for tests.
 *
 * Neutral shape — both Sentropic (org/folder/initiative) and radar (signal/fiche)
 * implement this interface by returning already-resolved chip data.
 * Route detection + entity-label loading stay app-owned.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single context chip already resolved by the host.
 *
 * `type`        — domain-specific discriminant (e.g. 'organization', 'folder',
 *                 'initiative', 'signal', 'fiche').  Open string to stay neutral.
 * `id`          — optional entity identifier (opaque to the library).
 * `label`       — display text, already resolved by the host.
 * `active`      — true while the entry is the current page context.
 * `used`        — true once the entry has been referenced in a chat turn.
 * `lastUsedAt`  — ISO-8601 timestamp of the last use, if any.
 */
export type ChatContextEntry = {
  type: string;
  id?: string;
  label: string;
  active?: boolean;
  used?: boolean;
  lastUsedAt?: string;
};

/**
 * Minimal Svelte-store-compatible readable interface.
 *
 * Typed as a structural subset of `import('svelte/store').Readable<T>` so the
 * package does not introduce a hard Svelte peer-dep for pure-TS consumers.
 * Any `readable()` / `writable()` / `derived()` store satisfies this shape.
 */
export type ReadableStore<T> = {
  subscribe: (
    run: (value: T) => void,
    invalidate?: () => void,
  ) => () => void;
};

/**
 * Host-injected provider that vends the current context chip list.
 *
 * The `context` store must emit already-resolved `ChatContextEntry[]`.
 * The library never reads route state or loads entity labels — those are
 * entirely the host's responsibility.
 */
export type ChatContextProvider = {
  context: ReadableStore<ChatContextEntry[]>;
};

// ---------------------------------------------------------------------------
// Default no-op provider
// ---------------------------------------------------------------------------

/**
 * Returns a `ChatContextProvider` whose `context` store always emits `[]`.
 *
 * Suitable as the default prop value for any component that accepts an optional
 * `contextProvider`, or as a test double when context is not relevant.
 */
export function createNoopChatContextProvider(): ChatContextProvider {
  return {
    context: {
      subscribe(run) {
        run([]);
        // No-op unsubscribe — no resources to clean up.
        return () => undefined;
      },
    },
  };
}
