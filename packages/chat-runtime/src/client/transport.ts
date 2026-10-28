/**
 * BR14a Lot 2 + Lot 1 Slice 1A — @sentropic/chat-ui transport interface.
 *
 * Browser-side wire contract for talking to a @sentropic/chat-core HTTP/SSE
 * endpoint. Lot 2 established the low-level SSE/fetch primitives.
 * Lot 1 Slice 1A adds the business-verb surface (sendMessage, retryMessage, etc.)
 * so host implementors can satisfy `ChatCoreHost` via a single transport object.
 *
 * Keep the default implementation thin: native `fetch` + native `EventSource`.
 * Hosts (web, Chrome side panel, VSCode webview) can swap this default for
 * their own adapter via {@link ChatCoreTransportFactory}.
 */

import type {
  ModelCatalog,
  RunHandle,
  SendMessagePayload,
  SessionSummary,
} from './chat-core-host.js';

// ---------------------------------------------------------------------------
// Low-level SSE + bootstrap transport
// ---------------------------------------------------------------------------

export interface ChatCoreTransport {
  /**
   * Open a Server-Sent Events stream for the given chat session.
   * `fromSeq` is forwarded as a query parameter when provided, leaving
   * cursor semantics to the server (BR-14b stream sequencer contract).
   */
  openStream(sessionId: string, fromSeq?: number): EventSource;
  /**
   * POST a chat-message request body to the chat-core HTTP endpoint and
   * return the raw `Response` for the caller to consume.
   */
  postMessage(sessionId: string, body: unknown): Promise<Response>;
  /**
   * Fetch the bootstrap payload for a session (messages, runtime, etc.).
   * Returns parsed JSON; callers narrow the type at the boundary.
   */
  fetchBootstrap(sessionId: string): Promise<unknown>;

  // ---------------------------------------------------------------------------
  // Business verbs (Lot 1 Slice 1A — derived from AppChatPanel real call-sites)
