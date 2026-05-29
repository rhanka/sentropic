/**
 * Cowork runner — barrel export. Ties the chat SSE round-trip to the desktop
 * tools: parse `pending_local_tool_calls` → consent gate → execute via provider
 * → post `tool-results`.
 */

export * from './tool-results.js';
export * from './cowork-runner.js';
