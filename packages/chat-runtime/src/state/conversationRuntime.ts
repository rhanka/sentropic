import type { ChatConversationSnapshot } from '@sentropic/chat-ui/conversation';
import type { DocumentHost } from '@sentropic/chat-ui/documents';
import type { ChatCoreHost, ModelCatalog } from '../client/chat-core-host.js';
import { buildAttachmentBandItems } from '../documents/attachmentState.js';
import { groupModelsByProvider, type ModelCatalogModel, type ModelCatalogProvider } from '../utils/model-selection.js';
import type { AttachLocalToolMachineOptions, ControllerSendPayload } from './chatLoopController.js';
import { createChatSessionRuntime, type ChatSessionRuntime } from './chatSessionRuntime.js';
import type { ChatContextProvider } from './chat-context.js';
import { createConversationCommands, type ConversationCommandState } from './conversationCommands.js';
import { hydrateConversationHistory } from './conversationHistory.js';
import { createAuthorizedLocalToolMachine, type LocalToolAuthorization } from './localToolAuthorization.js';

export type ConversationRuntimeOptions = {
  host: ChatCoreHost;
  session?: ChatSessionRuntime;
  selectedModel?: string;
  catalog?: ModelCatalog;
  contextProvider?: ChatContextProvider;
  documents?: DocumentHost;
  sendPayload?: () => Partial<ControllerSendPayload>;
  localTools?: AttachLocalToolMachineOptions;
  authorizeLocalTool?: LocalToolAuthorization;
  decidePermission?: (id: string, allow: boolean) => Promise<void>;
  permissionTimeoutMs?: number;
};

/** Host-owned runtime binding. Subscribing a view never constructs or disposes a session. */
export function createConversationRuntime(sessionId: string, options: ConversationRuntimeOptions) {
  const session = options.session ?? createChatSessionRuntime(sessionId);
  const listeners = new Set<(snapshot: ChatConversationSnapshot) => void>();
  let disposed = false;
  let historyGeneration = 0;
  let catalog = options.catalog;
  const notify = () => { if (!disposed && listeners.size) for (const listener of [...listeners]) listener(snapshot()); };
  const state: ConversationCommandState = {
    session, host: options.host, selectedModel: options.selectedModel ?? '', contextEntries: [],
    sending: false, error: null, documents: options.documents, sendPayload: options.sendPayload,
    decidePermission: options.decidePermission, notify,
  };
  const authorization = createAuthorizedLocalToolMachine({
    machine: options.localTools, authorize: options.authorizeLocalTool,
    permissionTimeoutMs: options.permissionTimeoutMs, onChange: notify,
    postResult: (streamId, toolCallId, result) => options.host.postLocalToolResult(streamId, toolCallId, result),
  });
  const snapshot = (): ChatConversationSnapshot => {
    const current = session.snapshot();
    const active = [...current.messages].reverse().find((message) => message.role === 'assistant' && message._localStatus === 'processing');
    return {
      sessionId: current.sessionId, items: current.projectedTimelineItems, draft: current.draft,
      sending: state.sending, error: state.error, selectedModel: state.selectedModel,
      models: (catalog?.models ?? []) as ModelCatalogModel[],
      modelGroups: groupModelsByProvider((catalog?.providers ?? []) as ModelCatalogProvider[], (catalog?.models ?? []) as ModelCatalogModel[]),
      contextEntries: state.contextEntries.map((entry) => ({ ...entry })),
      attachments: buildAttachmentBandItems(current.attachments), permissions: authorization.snapshot(),
      activeMessageId: active?.id ?? null, activeStreamId: active ? active._streamId ?? active.id : null,
    };
  };
  session.attach({ transport: options.host, streamClient: options.host.streamClient, localToolMachine: authorization.machine });
  const unsubscribeSession = session.subscribe(notify);
  const unsubscribeContext = options.contextProvider?.context.subscribe((entries) => {
    state.contextEntries = entries.map((entry) => ({ ...entry })); notify();
  });
  const commands = createConversationCommands(state);
  return {
    session, commands, snapshot,
    subscribe(listener: (value: ChatConversationSnapshot) => void) {
      if (disposed) throw new Error('Conversation runtime disposed');
      const unbind = session.bindView();
      listeners.add(listener); listener(snapshot());
      return () => { listeners.delete(listener); unbind(); };
    },
    async initialize() {
      const generation = ++historyGeneration;
      try {
        const [nextCatalog] = await Promise.all([
          catalog ? Promise.resolve(catalog) : options.host.fetchModelCatalog(),
          hydrateConversationHistory(session, options.host, () => !disposed && historyGeneration === generation),
        ]);
        if (disposed || historyGeneration !== generation) return;
        catalog = nextCatalog;
        if (!state.selectedModel) state.selectedModel = `${catalog.defaults?.provider_id ?? catalog.models[0]?.provider_id ?? ''}::${catalog.defaults?.model_id ?? catalog.models[0]?.model_id ?? ''}`;
      } catch (error) { if (!disposed) state.error = error instanceof Error ? error.message : String(error); }
      notify();
    },
    dispose() { disposed = true; historyGeneration++; authorization.dispose(); unsubscribeContext?.(); unsubscribeSession(); session.dispose(); listeners.clear(); },
  };
}
