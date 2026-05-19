/**
 * BR14a Lot 3 — @sentropic/chat-ui public TypeScript surface.
 *
 * Re-exports the package contracts so non-Svelte consumers can pull
 * transport, replay, renderer registry, host adapter types, UI-generic
 * stores, and pure chat utilities from a single entrypoint. Svelte
 * components are NOT re-exported here: consumers import them directly
 * through the `./components/*` package exports map so the bundler keeps
 * `.svelte` handling.
 */

export * from './client/transport.js';
export * from './client/replay.js';
export * from './renderers/registry.js';
export * from './hosts/types.js';
export * from './stores/chatWidgetLayout.js';
export * from './utils/chat-run-projection.js';
export * from './utils/chat-steer.js';
export * from './utils/chat-tool-scope.js';
export * from './utils/localToolStreamSync.js';
