/**
 * @sentropic/cowork-bridge — portable client bridge for Sentropic Cowork.
 *
 * Sub-entrypoints are also available for tree-shaking / host-specific imports:
 *   - `@sentropic/cowork-bridge/core`
 *   - `@sentropic/cowork-bridge/auth`
 *   - `@sentropic/cowork-bridge/tools`
 *   - `@sentropic/cowork-bridge/permissions`
 *
 * SSE streaming is intentionally NOT re-exported here: consume
 * `@sentropic/chat-ui`'s `StreamHub` (`createStreamHub`) directly.
 */

export * from './core/index.js';
export * from './auth/index.js';
export * from './desktop-rpc/index.js';
export * from './tools/index.js';
export * from './permissions/index.js';
