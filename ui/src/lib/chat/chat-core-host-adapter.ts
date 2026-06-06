/**
 * chat-core-host-adapter.ts — sentropic ChatCoreHost conformance proof.
 *
 * This file has ONE job: prove at TypeScript compile time that the EXISTING
 * sentropic API calls satisfy the `ChatCoreHost` interface. It wraps the real
 * apiFetch/apiGet/apiPost/apiPatch/apiDelete calls exactly as they appear in
 * AppChatPanel.svelte — zero behavior change, zero new runtime code.
 *
 * The `satisfies ChatCoreHost` assertion on `createSentropicChatCoreHost`
 * means `make typecheck-ui` fails if this adapter diverges from the contract.
 *
 * Call-site references match AppChatPanel.svelte line numbers at commit HEAD.
 */

import type { ChatCoreHost } from '@sentropic/chat-ui/client/chat-core-host';
import { apiFetch, apiGet, apiPost, apiPatch, apiDelete } from '$lib/utils/api';
import { streamHub } from '$lib/stores/streamHub';
import {
  chatSessionsUrl,
  chatSessionHistoryUrl,
  chatMessagesUrl,
  chatMessageRetryUrl,
  chatMessageStopUrl,
  chatMessageUrl,
  chatMessageFeedbackUrl,
  chatSessionUrl,
  chatMessageToolResultsUrl,
} from '$lib/chat/session-adapter';

/**
 * Factory returning a ChatCoreHost backed by sentropic's existing API layer.
 *
 * Usage: call once at mount, pass the result as `host` to ChatPanel (Lot 1+).
 * Today it is NOT yet used at runtime — it exists to enforce the type contract.
 */
export const createSentropicChatCoreHost = (): ChatCoreHost => {
  const host = {
    // -----------------------------------------------------------------------
    // fetchSessions — AppChatPanel:3679
    // -----------------------------------------------------------------------
    async fetchSessions() {
      return apiGet<{ sessions: Array<{ id: string; title: string; createdAt: string; updatedAt: string }> }>(
        chatSessionsUrl(),
      );
    },

    // -----------------------------------------------------------------------
    // fetchSessionHistory — AppChatPanel:3731
    // Returns raw Response so caller can stream ndjson line-by-line.
    // -----------------------------------------------------------------------
    fetchSessionHistory(sessionId: string, detail: 'summary' | 'full') {
      return apiFetch(chatSessionHistoryUrl(sessionId, detail), {
        method: 'GET',
        headers: { Accept: 'application/x-ndjson' },
      });
    },

    // -----------------------------------------------------------------------
    // sendMessage — AppChatPanel:4341
    // -----------------------------------------------------------------------
    async sendMessage(payload) {
      return apiPost<{
        sessionId: string;
        userMessageId: string;
        assistantMessageId: string;
        streamId: string;
        jobId: string;
      }>(chatMessagesUrl(), payload);
    },

    // -----------------------------------------------------------------------
    // retryMessage — AppChatPanel:2996
    // -----------------------------------------------------------------------
    async retryMessage(messageId, opts) {
      return apiPost<{
        sessionId: string;
        userMessageId: string;
        assistantMessageId: string;
        streamId: string;
        jobId: string;
      }>(chatMessageRetryUrl(messageId), {
        providerId: opts.providerId,
        model: opts.model,
      });
    },

    // -----------------------------------------------------------------------
    // stopMessage — AppChatPanel:4393
    // -----------------------------------------------------------------------
    async stopMessage(messageId) {
      await apiPost(chatMessageStopUrl(messageId));
    },

    // -----------------------------------------------------------------------
    // editMessage — AppChatPanel:2917
    // -----------------------------------------------------------------------
    async editMessage(messageId, content) {
      await apiPatch(chatMessageUrl(messageId), { content });
    },

    // -----------------------------------------------------------------------
    // setFeedback — AppChatPanel:4407
    // -----------------------------------------------------------------------
    async setFeedback(messageId, vote) {
      await apiPost(chatMessageFeedbackUrl(messageId), { vote });
    },

    // -----------------------------------------------------------------------
    // deleteSession — AppChatPanel:4056
    // -----------------------------------------------------------------------
    async deleteSession(sessionId) {
      await apiDelete(chatSessionUrl(sessionId));
    },

    // -----------------------------------------------------------------------
    // pollJob — AppChatPanel:4117
    // -----------------------------------------------------------------------
    async pollJob(jobId) {
      return apiGet<{ status?: string }>(
        `/queue/jobs/${encodeURIComponent(jobId)}`,
      );
    },

    // -----------------------------------------------------------------------
    // postLocalToolResult — AppChatPanel:796-827
    // The retry loop lives in AppChatPanel (app-level concern); this is the
    // single-attempt wire call that AppChatPanel retries around.
    // -----------------------------------------------------------------------
    async postLocalToolResult(streamId, toolCallId, result) {
      await apiPost(chatMessageToolResultsUrl(streamId), {
        toolCallId,
        result,
      });
    },

    // -----------------------------------------------------------------------
    // fetchModelCatalog — AppChatPanel:4142
    // -----------------------------------------------------------------------
    async fetchModelCatalog() {
      return apiGet<{
        providers: Array<{ provider_id: string; label: string; status: 'ready' | 'planned' }>;
        models: Array<{ provider_id: string; model_id: string; label: string; default_contexts: string[] }>;
        defaults?: { provider_id?: string; model_id?: string };
      }>('/models/catalog');
    },

    // -----------------------------------------------------------------------
    // postSteer — AppChatPanel:3338 via postChatSteer(apiPost, targetStreamId, steerText)
    // postChatSteer builds: apiPost('/chat/messages/:streamId/steer', { message })
    // -----------------------------------------------------------------------
    async postSteer(streamId, message) {
      await apiPost(
        `/chat/messages/${encodeURIComponent(streamId)}/steer`,
        { message },
      );
    },

    // -----------------------------------------------------------------------
    // streamClient — imported singleton from '$lib/stores/streamHub'
    // AppChatPanel wires: createSentropicWebHost({ streamClient: streamHub })
    // -----------------------------------------------------------------------
    streamClient: streamHub,
  } satisfies ChatCoreHost;

  return host;
};
