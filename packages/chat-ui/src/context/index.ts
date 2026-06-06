/**
 * @sentropic/chat-ui/context
 *
 * Generic context module — pure TS, zero sentropic domain strings.
 *
 * Provides:
 *   - ContextHost interface (D3 async label resolution contract)
 *   - createContextModule(host) factory — reactive entry store + lifecycle
 *   - Generic helpers: toChatRouteContextKey, upsertRouteContextEntry,
 *     selectActiveChatContexts
 *   - Re-exports ChatContextEntry / ChatContextProvider / ReadableStore
 *     from state/chat-context for convenience.
 */

export type {
  ChatContextEntry,
  ChatContextProvider,
  ReadableStore,
} from '../state/chat-context.js';

export {
  createNoopChatContextProvider,
} from '../state/chat-context.js';

export {
  toChatRouteContextKey,
  upsertRouteContextEntry,
  selectActiveChatContexts,
} from './context-entry.js';

export { createContextModule } from './module.js';

export type { ContextHost, ContextModule } from './module.js';
