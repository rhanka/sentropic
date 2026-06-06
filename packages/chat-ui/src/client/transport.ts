/**
 * BR14a Lot 2 — @sentropic/chat-ui transport interface.
 *
 * Browser-side wire contract for talking to a @sentropic/chat-core HTTP/SSE
 * endpoint. The interface only declares HTTP/SSE primitives — it does NOT
 * model business behaviour (sessions, messages, steering, replay, tool
 * results). Higher-level methods land in BR-14a Lot 3+ once the package
 * adopts the full ChatTransport surface from
 * `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md`.
 *
 * Keep the implementation thin: native `fetch` + native `EventSource`.
 * Hosts (web, Chrome side panel, VSCode webview) can swap this default for
 * their own adapter via {@link ChatCoreTransportFactory}.
 */

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
}

export interface ChatCoreTransportFactory {
  (baseUrl: string, headers?: Record<string, string>): ChatCoreTransport;
}

const joinUrl = (baseUrl: string, path: string): string => {
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
};

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
      let target = joinUrl(baseUrl, `/chat/sessions/${sessionId}/stream`);
      if (typeof fromSeq === 'number') {
        const separator = target.includes('?') ? '&' : '?';
        target = `${target}${separator}fromSeq=${encodeURIComponent(String(fromSeq))}`;
      }
      return new EventSource(target);
    },
    async postMessage(sessionId, body) {
      return fetch(joinUrl(baseUrl, `/chat/sessions/${sessionId}/messages`), {
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
        joinUrl(baseUrl, `/chat/sessions/${sessionId}/bootstrap`),
        {
          method: 'GET',
          headers: { ...requestHeaders },
        },
      );
      return response.json() as Promise<unknown>;
    },
  };
};
