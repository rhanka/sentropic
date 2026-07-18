/**
 * BR-72 Wave-1 — `@sentropic/mcp-connector-gmail` public surface (benchmark proof).
 *
 * Private package, not published. See README.md.
 */
export { createGmailConnector } from './adapter.js';
export {
  gmailManifest,
  searchThreads,
  getMessage,
  listDrafts,
  getDraft,
} from './manifest.js';
export type {
  SyntheticThreadSummary,
  SyntheticMessage,
  SyntheticDraftSummary,
  SyntheticDraft,
} from './fixtures.js';
