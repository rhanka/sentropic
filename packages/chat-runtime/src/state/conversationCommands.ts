import type { ChatConversationCommands } from '@sentropic/chat-ui/conversation';
import type { DocumentHost } from '@sentropic/chat-ui/documents';
import type { ChatCoreHost } from '../client/chat-core-host.js';
import { parseModelSelectionKey } from '../utils/model-selection.js';
import type { ChatContextEntry } from './chat-context.js';
import type { ControllerSendPayload } from './chatLoopController.js';
import type { ChatSessionRuntime } from './chatSessionRuntime.js';
import type { createConversationDocuments } from './conversationDocuments.js';

export type ConversationCommandState = {
  session: ChatSessionRuntime;
  host: ChatCoreHost;
  selectedModel: string;
  contextEntries: ChatContextEntry[];
  sending: boolean;
  error: string | null;
  documents?: DocumentHost;
  documentCommands: ReturnType<typeof createConversationDocuments>;
  sendPayload?: () => Partial<ControllerSendPayload>;
  decidePermission?: (id: string, allow: boolean) => Promise<void>;
  notify(): void;
};

export function createConversationCommands(state: ConversationCommandState): ChatConversationCommands {
  const run = async (operation: () => Promise<void>) => {
    state.error = null;
    try { await operation(); }
    catch (error) { state.error = error instanceof Error ? error.message : String(error); }
    finally { state.notify(); }
  };
  const selection = () => {
    const selected = parseModelSelectionKey(state.selectedModel);
    return selected ? { providerId: selected.providerId, model: selected.modelId } : {};
  };
  return {
    setDraft: (value) => state.session.setDraft(value),
    send: () => run(async () => {
      const current = state.session.snapshot();
      if (state.sending || (!current.draft.trim() && !current.attachmentSummary.ready)) return;
      if (current.attachmentSummary.pending || current.attachmentSummary.uploading) return;
      state.sending = true;
      state.notify();
      const contexts = state.contextEntries.filter((entry) => entry.active !== false && entry.id)
        .map((entry) => ({ contextType: entry.type, contextId: entry.id! }));
      const primary = contexts.at(-1);
      const attachments = current.attachments.filter((attachment) => attachment.state === 'ready' && attachment.documentId)
        .map((attachment) => ({
          kind: attachment.kind, source: 'context_document' as const, documentId: attachment.documentId!,
          fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes,
        }));
      try {
        await state.session.send({
          ...state.sendPayload?.(), ...selection(),
          sessionId: current.sessionId, content: current.draft.trim(), contexts,
          ...(primary ? { primaryContextType: primary.contextType, primaryContextId: primary.contextId } : {}),
          attachments,
        }, {
          buildUserMessage: (handle) => ({
            id: handle.userMessageId, role: 'user', content: current.draft.trim(),
            sessionId: current.sessionId, createdAt: new Date().toISOString(),
            attachments, _localStatus: 'completed',
          }),
          buildAssistantMessage: (base) => ({ ...base }),
        });
        if (state.session.snapshot().draft === current.draft) state.session.setDraft('');
        const submitted = new Set(current.attachments.map((attachment) => attachment.id));
        state.session.setAttachments(state.session.snapshot().attachments.filter((attachment) => !submitted.has(attachment.id)));
      } finally { state.sending = false; }
    }),
    retry: (messageId) => run(async () => {
      const messages = state.session.snapshot().messages;
      const at = messages.findIndex((message) => message.id === messageId);
      const target = messages[at]?.role === 'assistant'
        ? messages.slice(0, at).reverse().find((message) => message.role === 'user')?.id : messageId;
      if (!target) return;
      const selected = selection();
      await state.session.retry(target, {
        providerId: selected.providerId ?? '', model: selected.model ?? '',
        buildAssistantMessage: (base) => ({ ...base }),
      });
    }),
    stop: (id) => run(() => state.session.stop(id)),
    edit: (id, content) => run(() => state.session.edit(id, content)),
    setFeedback: (id, vote) => run(() => state.session.setFeedback(id, vote)),
    steer: () => run(async () => {
      const current = state.session.snapshot();
      const active = [...current.messages].reverse().find((message) => message.role === 'assistant' && message._localStatus === 'processing');
      if (!active || !current.draft.trim()) return;
      await state.session.sendSteer(current.draft.trim(), active._streamId ?? active.id, {
        sessionId: current.sessionId, targetAssistantMessageId: active.id, ackMessage: current.draft.trim(),
      });
      if (state.session.snapshot().draft === current.draft) state.session.setDraft('');
    }),
    selectModel(value) { if (parseModelSelectionKey(value)) state.selectedModel = value; state.notify(); },
    toggleContext(key, enabled) {
      state.contextEntries = state.contextEntries.map((entry) => `${entry.type}:${entry.id ?? ''}` === key ? { ...entry, active: enabled } : entry);
      state.notify();
    },
    attachFiles: (files, source) => run(() => state.documentCommands.attach(files, source)),
    retryAttachment: (id) => run(() => state.documentCommands.retry(id)),
    removeAttachment: (id) => run(() => state.documentCommands.remove(id)),
    downloadGeneratedFile: (card) => run(async () => {
      if (!state.documents) throw new Error('Document host unavailable');
      await state.documents.downloadGeneratedFile(card);
    }),
    decidePermission: (id, allow) => run(async () => {
      if (state.decidePermission) await state.decidePermission(id, allow);
    }),
  };
}
