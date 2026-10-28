/**
 * ChatCoreHost — typed contract for the generic chat core loop host.
 *
 * This interface captures the REAL call-sites observed in the host
 * implementation. Every method is annotated with where it originates.
 *
 * Design rules (SPEC_EVOL_CHATUI_MODULARIZATION §3, R1, §9-D6):
 * - Zero app-specific domain strings in this file (no entity-type names, no route ids).
 * - Signatures derived from REAL code — not aspirational.
 * - The StreamHub client surface is first-class (not deferred).
 * - postLocalToolResult covers the local-tool result channel.
 * - postSteer covers the steer channel.
 *
 * Reversible decisions taken here (note for double-review):
 * - fetchSessionHistory returns `Promise<Response>` (raw ndjson) matching the
 *   real apiFetch call at AppChatPanel:3731 — the caller streams it with a
 *   ReadableStream reader. Returning parsed JSON would require buffering the
 *   entire ndjson up-front, losing the streaming property.
 * - pollJob signature includes only the minimal fields the core loop reads
 *   (`status?: string`) — the actual job record may have more; callers narrow.
 * - streamClient is a required field (not a method) — this matches today's
 *   ChatUiWebHost shape and how AppChatPanel consumes streamHub.
 *
 * IRREVERSIBLE-risk flag: streamClient typing — see FLAG section in commit
 * message / conductor report.
 */

import type { StreamHubClient } from './streamTypes.js';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/**
 * Minimal summary of a chat session as returned by the sessions list endpoint.
 * Derived from AppChatPanel:3679 `{ sessions: ChatSession[] }` where
 * ChatSession has at minimum `id`, `title`, `createdAt`, `updatedAt`.
 */
export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Payload for sending a new message. Derived from AppChatPanel:4268-4347.
 * `sessionId` is optional — absent on the first message of a new session.
 * `content` is the user text. All other fields are optional extensions.
 */
export type SendMessagePayload = {
  sessionId?: string;
  content: string;
  providerId?: string;
  model?: string;
  /** Primary context hint (e.g. current entity type/id). Host-supplied. */
  primaryContextType?: string;
