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
  // ---------------------------------------------------------------------------

  /** Fetch the list of sessions for the current user. */
  fetchSessions(): Promise<{ sessions: SessionSummary[] }>;

  /**
   * Fetch session message history as a raw ndjson `Response`.
   * The caller streams the body line-by-line with `response.body.getReader()`.
   */
  fetchSessionHistory(sessionId: string, detail: 'summary' | 'full'): Promise<Response>;

  /** Send a new user message (optionally creating a session). */
  sendMessage(payload: SendMessagePayload): Promise<RunHandle>;

  /** Retry an existing message with the given model selection. */
  retryMessage(
    messageId: string,
    opts: { providerId: string; model: string },
  ): Promise<RunHandle>;

  /** Stop the active assistant generation for a message. */
  stopMessage(messageId: string): Promise<void>;

  /** Patch the text content of an existing user message. */
  editMessage(messageId: string, content: string): Promise<void>;

  /** Submit thumbs-up/down/clear feedback on an assistant message. */
  setFeedback(messageId: string, vote: 'up' | 'down' | 'clear'): Promise<void>;

  /** Delete a session and all its messages. */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Poll a background job for its status.
   * Returns `{ status?: string }` — caller reads terminal values.
   */
  pollJob(jobId: string): Promise<{ status?: string }>;

  /**
   * Post a local-tool result back to the server for the given stream + toolCallId.
   * The retry loop (race-condition back-off) is the caller's responsibility.
   */
  postLocalToolResult(streamId: string, toolCallId: string, result: unknown): Promise<void>;

  /** Post a steer message to a running assistant stream. */
  postSteer(streamId: string, message: string): Promise<void>;

  /** Fetch the model catalog (providers + models + defaults). */
  fetchModelCatalog(): Promise<ModelCatalog>;
}

export interface ChatCoreTransportFactory {
  (baseUrl: string, headers?: Record<string, string>): ChatCoreTransport;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const joinUrl = (baseUrl: string, path: string): string => {
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
};

const encodeId = (value: string): string => encodeURIComponent(value);

const doJson = async <T = unknown>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> => {
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw Object.assign(new Error(text || response.statusText), { status: response.status });
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
};

// ---------------------------------------------------------------------------
// Default transport implementation (native fetch + EventSource)
// ---------------------------------------------------------------------------

export const createDefaultTransport: ChatCoreTransportFactory = (
  baseUrl,
  headers,
) => {
  const requestHeaders = { ...(headers ?? {}) };

  return {
    openStream(sessionId, fromSeq) {
      // Build the target as a plain string. Native EventSource resolves a
      // relative URL against the document base, whereas `new URL(path)` (no
      // base) THROWS when baseUrl is relative or '' (e.g. same-origin hosts).
      // Staying string-based keeps openStream relative-safe like postMessage's
      // fetch(), which tolerates relative URLs.
      let target = joinUrl(baseUrl, `/chat/sessions/${encodeId(sessionId)}/stream`);
      if (typeof fromSeq === 'number') {
        const separator = target.includes('?') ? '&' : '?';
        target = `${target}${separator}fromSeq=${encodeURIComponent(String(fromSeq))}`;
      }
      return new EventSource(target);
    },

    async postMessage(sessionId, body) {
      return fetch(joinUrl(baseUrl, `/chat/sessions/${encodeId(sessionId)}/messages`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...requestHeaders,
        },
        body: JSON.stringify(body),
      });
    },

    async fetchBootstrap(sessionId) {
      const response = await fetch(
        joinUrl(baseUrl, `/chat/sessions/${encodeId(sessionId)}/bootstrap`),
        {
          method: 'GET',
          headers: { ...requestHeaders },
        },
      );
      return response.json() as Promise<unknown>;
    },

    // -----------------------------------------------------------------------
    // Business verbs
    // -----------------------------------------------------------------------

    async fetchSessions() {
      return doJson<{ sessions: SessionSummary[] }>(
        joinUrl(baseUrl, '/chat/sessions'),
        'GET',
        requestHeaders,
      );
    },

    fetchSessionHistory(sessionId, detail) {
      return fetch(
        joinUrl(baseUrl, `/chat/sessions/${encodeId(sessionId)}/history?runtimeDetails=${encodeURIComponent(detail)}`),
        {
          method: 'GET',
          headers: { Accept: 'application/x-ndjson', ...requestHeaders },
        },
      );
    },

    async sendMessage(payload) {
      return doJson<RunHandle>(
        joinUrl(baseUrl, '/chat/messages'),
        'POST',
        requestHeaders,
        payload,
      );
    },

    async retryMessage(messageId, opts) {
      return doJson<RunHandle>(
        joinUrl(baseUrl, `/chat/messages/${encodeId(messageId)}/retry`),
        'POST',
        requestHeaders,
        opts,
      );
    },

    async stopMessage(messageId) {
      await doJson(
        joinUrl(baseUrl, `/chat/messages/${encodeId(messageId)}/stop`),
        'POST',
        requestHeaders,
      );
    },

    async editMessage(messageId, content) {
      await doJson(
        joinUrl(baseUrl, `/chat/messages/${encodeId(messageId)}`),
        'PATCH',
        requestHeaders,
        { content },
      );
    },

    async setFeedback(messageId, vote) {
      await doJson(
        joinUrl(baseUrl, `/chat/messages/${encodeId(messageId)}/feedback`),
        'POST',
        requestHeaders,
        { vote },
      );
    },

    async deleteSession(sessionId) {
      await doJson(
        joinUrl(baseUrl, `/chat/sessions/${encodeId(sessionId)}`),
        'DELETE',
        requestHeaders,
      );
    },

    async pollJob(jobId) {
      return doJson<{ status?: string }>(
        joinUrl(baseUrl, `/queue/jobs/${encodeId(jobId)}`),
        'GET',
        requestHeaders,
      );
    },

    async postLocalToolResult(streamId, toolCallId, result) {
      await doJson(
        joinUrl(baseUrl, `/chat/messages/${encodeId(streamId)}/tool-results`),
        'POST',
        requestHeaders,
        { toolCallId, result },
      );
    },

    async postSteer(streamId, message) {
      await doJson(
        joinUrl(baseUrl, `/chat/messages/${encodeId(streamId)}/steer`),
        'POST',
        requestHeaders,
        { message },
      );
    },

    async fetchModelCatalog() {
      return doJson<ModelCatalog>(
        joinUrl(baseUrl, '/models/catalog'),
        'GET',
        requestHeaders,
      );
    },
  };
};
