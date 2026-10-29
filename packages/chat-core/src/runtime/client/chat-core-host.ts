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
  primaryContextId?: string;
  /** All active contexts (may include primaryContext as first entry). */
  contexts?: Array<{ contextType: string; contextId: string }>;
  /** Enabled tool IDs (server-side tools). */
  tools?: string[];
  /** Local tool definitions forwarded to the server when runtime is available. */
  localToolDefinitions?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  /** Attached documents referenced by documentId. */
  attachments?: Array<{
    kind: 'image' | 'file';
    source: 'context_document';
    documentId: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
};

/**
 * Handle returned by sendMessage / retryMessage — the identifiers needed to
 * bootstrap the assistant run (optimistic UI + stream subscription + job poll).
 * Derived from AppChatPanel:4341-4347 and :3002-3006.
 */
export type RunHandle = {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  streamId: string;
  jobId: string;
};

/**
 * Model catalog as returned by fetchModelCatalog.
 * Derived from AppChatPanel:4140-4165 (`/models/catalog` endpoint payload).
 */
export type ModelCatalog = {
  providers: Array<{
    provider_id: string;
    label: string;
    status: 'ready' | 'planned';
  }>;
  models: Array<{
    provider_id: string;
    model_id: string;
    label: string;
    default_contexts: string[];
  }>;
  defaults?: {
    provider_id?: string;
    model_id?: string;
  };
};

// ---------------------------------------------------------------------------
// ChatCoreHost contract
// ---------------------------------------------------------------------------

/**
 * ChatCoreHost — the full surface the generic chat core loop requires from
 * its embedding application. SPEC §4 / R1 / §10-R1.
 *
 * Implementors: wrap existing API calls + streamHub so that `make typecheck-ui`
 * proves conformance. Zero behavior change required to satisfy this interface.
 */
export interface ChatCoreHost {
  // -------------------------------------------------------------------------
  // REST verbs — transport layer
  // -------------------------------------------------------------------------

  /**
   * Fetch the list of sessions for the current user.
   * Call-site: AppChatPanel:3679 `apiGet<{ sessions: ChatSession[] }>(chatSessionsUrl())`
   */
  fetchSessions(): Promise<{ sessions: SessionSummary[] }>;

  /**
   * Fetch the full ndjson history for a session. Returns a raw `Response`
   * because the caller streams it line-by-line via `response.body.getReader()`.
   * Call-site: AppChatPanel:3731 `apiFetch(chatSessionHistoryUrl(id, 'summary'), { headers: Accept: 'application/x-ndjson' })`
   */
  fetchSessionHistory(
    sessionId: string,
    detail: 'summary' | 'full',
  ): Promise<Response>;

  /**
   * Send a new user message, optionally creating a session.
   * Call-site: AppChatPanel:4341 `apiPost<RunHandle>(chatMessagesUrl(), payload)`
   */
  sendMessage(payload: SendMessagePayload): Promise<RunHandle>;

  /**
   * Retry an existing message with the given model selection.
   * Call-site: AppChatPanel:2996 `apiPost<RunHandle>(chatMessageRetryUrl(messageId), { providerId, model })`
   */
  retryMessage(
    messageId: string,
    opts: { providerId: string; model: string },
  ): Promise<RunHandle>;

  /**
   * Stop the active assistant generation for a message.
   * Call-site: AppChatPanel:4393 `apiPost(chatMessageStopUrl(activeAssistantMessage.id))`
   */
  stopMessage(messageId: string): Promise<void>;

  /**
   * Edit the content of an existing user message (before retrying).
   * Call-site: AppChatPanel:2917 `apiPatch(chatMessageUrl(messageId), { content: next })`
   */
  editMessage(messageId: string, content: string): Promise<void>;

  /**
   * Submit feedback (thumbs up/down/clear) on an assistant message.
   * Call-site: AppChatPanel:4407 `apiPost(chatMessageFeedbackUrl(messageId), { vote: next })`
   */
  setFeedback(
    messageId: string,
    vote: 'up' | 'down' | 'clear',
  ): Promise<void>;

  /**
   * Delete the current session and reset local state.
   * Call-site: AppChatPanel:4056 `apiDelete(chatSessionUrl(sessionId))`
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Poll a background job until terminal (completed/failed).
   * Returns the raw job record — caller reads `status?: string`.
   * Call-site: AppChatPanel:4117 `apiGet<{ status?: string }>('/queue/jobs/:id')`
   */
  pollJob(jobId: string): Promise<{ status?: string }>;

  /**
   * Post a local tool result back to the server for the given stream + toolCallId.
   * Implements the local-tool result channel (R1 — local-tool result lifecycle).
   * Call-site: AppChatPanel:796-827 `postLocalToolResultWithRetry` →
   *   `apiPost(chatMessageToolResultsUrl(streamId), { toolCallId, result })`
   * Note: the retry loop (12 attempts, 150ms*attempt back-off for 400/race)
   * is an app-level concern — the host may or may not implement it internally.
   */
  postLocalToolResult(
    streamId: string,
    toolCallId: string,
    result: unknown,
  ): Promise<void>;

  /**
   * Fetch the model catalog (providers + models + defaults).
   * Call-site: AppChatPanel:4142 `apiGet<ModelCatalogPayload>('/models/catalog')`
   */
  fetchModelCatalog(): Promise<ModelCatalog>;

  /**
   * Post a steer message to a running assistant stream.
   * Implements the steer channel (R1 — steer).
   * Call-site: AppChatPanel:3338 `postChatSteer(apiPost, targetStreamId, steerText)`
   *   → `apiPost('/chat/messages/:streamId/steer', { message })`
   */
  postSteer(streamId: string, message: string): Promise<void>;

  // -------------------------------------------------------------------------
  // StreamHub — stream client surface (R1 — StreamHub/transport)
  // -------------------------------------------------------------------------

  /**
   * The StreamHub client used for SSE subscriptions.
   * Provides: set / setStream / setJobUpdates / delete / reset / clearCaches.
   * Call-site: AppChatPanel imports `streamHub` from '$lib/stores/streamHub'
   * and passes it to createSentropicWebHost as `streamClient: streamHub`.
   * The component then calls e.g. `host.streamClient.setStream(...)`.
   *
   * This is a required field (not a factory) — matching today's ChatUiWebHost
   * shape and how the real web host wires the stream connection.
   */
  streamClient: StreamHubClient;
}
