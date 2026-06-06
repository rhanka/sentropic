import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';
import {
  createWebHost,
  type ChatUiDocumentHostAdapter,
  type ChatUiJobsHostAdapter,
  type ChatUiLabelResolver,
  type ChatUiWebHost,
  type CreateWebHostInput,
} from '@sentropic/chat-ui/hosts/createWebHost';
import type { ChatCoreTransport } from '@sentropic/chat-ui/client/transport';
import { createRendererRegistry } from '@sentropic/chat-ui/renderers/registry';
import type { LocalToolsAdapter } from '@sentropic/chat-ui/hosts/types';
import type { ContextProvider } from '@sentropic/cowork-bridge/core';
import { API_BASE_URL } from '$lib/config';
import { getApiBaseUrl } from '@sentropic/cowork-bridge/core';
import { streamHub } from '$lib/stores/streamHub';
import { loadJobs, queueStore } from '$lib/stores/queue';
import { apiFetch, apiGet, apiPost, apiPatch, apiDelete } from '$lib/utils/api';
import {
  chatMessagesUrl,
  chatMessageFeedbackUrl,
  chatMessageRetryUrl,
  chatMessageStopUrl,
  chatMessageToolResultsUrl,
  chatMessageUrl,
  chatSessionHistoryUrl,
  chatSessionsUrl,
  chatSessionUrl,
} from '$lib/chat/session-adapter';
import {
  createChatSessionDocumentContext,
  createGoogleDriveChatAttachInput,
  extractGeneratedFileCardsFromEvents,
  extractGeneratedFileCardsFromRuntimeSummary,
} from '$lib/chat/document-adapter';
import { getCommentSectionLabel } from '$lib/chat/comment-adapter';

const activeJobStatuses = new Set(['pending', 'processing']);

const asObjectBody = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : { payload: body };

const getChatApiBaseUrl = (): string => getApiBaseUrl() ?? API_BASE_URL;

export const createSentropicChatTransport = (): ChatCoreTransport => ({
  openStream(sessionId, fromSeq) {
    const url = new URL(
      `${getChatApiBaseUrl()}${chatSessionUrl(sessionId)}/stream`,
    );
    if (typeof fromSeq === 'number') {
      url.searchParams.set('fromSeq', String(fromSeq));
    }
    return new EventSource(url.toString());
  },
  postMessage(sessionId, body) {
    return apiFetch(chatMessagesUrl(), {
      method: 'POST',
      body: JSON.stringify({ ...asObjectBody(body), sessionId }),
    });
  },
  async fetchBootstrap(sessionId) {
    const response = await apiFetch(`${chatSessionUrl(sessionId)}/bootstrap`, {
      method: 'GET',
    });
    return response.json() as Promise<unknown>;
  },

  // ---------------------------------------------------------------------------
  // Business verbs (Slice 1A — required by ChatCoreTransport interface)
  // Delegates to the same auth-aware API utils used by AppChatPanel.
  // ---------------------------------------------------------------------------

  async fetchSessions() {
    return apiGet<{ sessions: Array<{ id: string; title: string; createdAt: string; updatedAt: string }> }>(
      chatSessionsUrl(),
    );
  },

  fetchSessionHistory(sessionId, detail) {
    return apiFetch(chatSessionHistoryUrl(sessionId, detail), {
      method: 'GET',
      headers: { Accept: 'application/x-ndjson' },
    });
  },

  async sendMessage(payload) {
    return apiPost<{ sessionId: string; userMessageId: string; assistantMessageId: string; streamId: string; jobId: string }>(
      chatMessagesUrl(),
      payload,
    );
  },

  async retryMessage(messageId, opts) {
    return apiPost<{ sessionId: string; userMessageId: string; assistantMessageId: string; streamId: string; jobId: string }>(
      chatMessageRetryUrl(messageId),
      { providerId: opts.providerId, model: opts.model },
    );
  },

  async stopMessage(messageId) {
    await apiPost(chatMessageStopUrl(messageId));
  },

  async editMessage(messageId, content) {
    await apiPatch(chatMessageUrl(messageId), { content });
  },

  async setFeedback(messageId, vote) {
    await apiPost(chatMessageFeedbackUrl(messageId), { vote });
  },

  async deleteSession(sessionId) {
    await apiDelete(chatSessionUrl(sessionId));
  },

  async pollJob(jobId) {
    return apiGet<{ status?: string }>(`/queue/jobs/${encodeURIComponent(jobId)}`);
  },

  async postLocalToolResult(streamId, toolCallId, result) {
    await apiPost(chatMessageToolResultsUrl(streamId), { toolCallId, result });
  },

  async postSteer(streamId, message) {
    await apiPost(`/chat/messages/${encodeURIComponent(streamId)}/steer`, { message });
  },

  async fetchModelCatalog() {
    return apiGet<{ providers: Array<{ provider_id: string; label: string; status: 'ready' | 'planned' }>; models: Array<{ provider_id: string; model_id: string; label: string; default_contexts: string[] }>; defaults?: { provider_id?: string; model_id?: string } }>(
      '/models/catalog',
    );
  },
});

export const createSentropicLabelResolver = (): ChatUiLabelResolver => {
  return (key, options) => get(_)(key, options);
};

export const createSentropicJobsHostAdapter = (): ChatUiJobsHostAdapter => {
  const labels = createSentropicLabelResolver();
  return {
    activeJobsCount: () =>
      get(queueStore).jobs.filter((job) => activeJobStatuses.has(job.status))
        .length,
    failedJobsCount: () =>
      get(queueStore).jobs.filter((job) => job.status === 'failed').length,
    queueTabLabel: labels('chat.tabs.jobs'),
    purgeMine: async () => {
      await apiPost('/queue/purge-mine', { status: 'all' });
      await loadJobs();
    },
  };
};

export const createSentropicDocumentHostAdapter =
  (): ChatUiDocumentHostAdapter => ({
    createSessionContext: createChatSessionDocumentContext,
    extractGeneratedFileCards(input) {
      if (Array.isArray(input)) {
        return extractGeneratedFileCardsFromEvents(
          input as Parameters<typeof extractGeneratedFileCardsFromEvents>[0],
        );
      }
      return extractGeneratedFileCardsFromRuntimeSummary(
        input as Parameters<typeof extractGeneratedFileCardsFromRuntimeSummary>[0],
      );
    },
    attachGoogleDriveFiles: createGoogleDriveChatAttachInput,
  });

export const createSentropicWebHost = (input: {
  contextProvider?: ContextProvider;
  localTools?: LocalToolsAdapter;
  overrides?: Partial<CreateWebHostInput>;
} = {}): ChatUiWebHost => {
  const labels = createSentropicLabelResolver();
  return createWebHost({
    transport: createSentropicChatTransport(),
    streamClient: streamHub,
    labels,
    renderers: createRendererRegistry(),
    localTools: input.localTools,
    contextProvider: input.contextProvider,
    jobs: createSentropicJobsHostAdapter(),
    comments: {
      resolveSectionLabel: ({ type, key }) =>
        getCommentSectionLabel(type, key, labels),
    },
    documents: createSentropicDocumentHostAdapter(),
    ...input.overrides,
  });
};
