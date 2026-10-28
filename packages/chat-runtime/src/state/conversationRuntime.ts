import type { ChatConversationSnapshot } from '@sentropic/chat-runtime/conversation';
import type { DocumentHost } from '@sentropic/chat-runtime/documents';
import type { ChatCoreHost, ModelCatalog } from '../client/chat-core-host.js';
import type { CheckpointHost } from '../checkpoints/index.js';
import { createConversationCheckpoints } from './conversationCheckpoints.js';
import { buildAttachmentBandItems } from '../documents/attachmentState.js';
import { extractGeneratedFileCardsFromEvents } from '../documents/generatedFileCards.js';
import { createConversationDocuments } from './conversationDocuments.js';
import { groupModelsByProvider, type ModelCatalogModel, type ModelCatalogProvider } from '@sentropic/chat-ui/utils/model-selection';
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
  checkpointHost?: CheckpointHost;
  sendPayload?: () => Partial<ControllerSendPayload>;
  localTools?: AttachLocalToolMachineOptions;
  authorizeLocalTool?: LocalToolAuthorization;
  decidePermission?: (id: string, allow: boolean) => Promise<void>;
  permissionTimeoutMs?: number;
};

/** Host-owned runtime binding. Subscribing a view never constructs or disposes a session. */
export function createConversationRuntime(sessionId: string, options: ConversationRuntimeOptions) {
  const session = options.session ?? createChatSessionRuntime(sessionId);
  const documents = createConversationDocuments(session, options.documents);
  const listeners = new Set<(snapshot: ChatConversationSnapshot) => void>();
  let disposed = false;
  let historyGeneration = 0;
  let catalog = options.catalog;
  const notify = () => { if (!disposed && listeners.size) for (const listener of [...listeners]) listener(snapshot()); };
  const checkpoints = createConversationCheckpoints(session, { host: options.checkpointHost, notify,
    reload: () => hydrateConversationHistory(session, options.host, () => !disposed) });
  const state: ConversationCommandState = {
    session, host: options.host, selectedModel: options.selectedModel ?? '', contextEntries: [],
    sending: false, error: null, documents: options.documents, documentCommands: documents, checkpointCommands: checkpoints, sendPayload: options.sendPayload,
    async decidePermission(id, allow) {
      const prompt = session.snapshot().pendingLocalToolPermissionPrompts.find((entry) => `native:${entry.streamId}:${entry.toolCallId}` === id);
      if (prompt) await session.decideLocalToolPermission(prompt, allow ? 'allow_once' : 'deny_once');
      else if (options.decidePermission) await options.decidePermission(id, allow);
      else await authorization.decide(id, allow);
    }, notify,
  };
  const authorization = createAuthorizedLocalToolMachine({
    machine: options.localTools, authorize: options.authorizeLocalTool,
    permissionTimeoutMs: options.permissionTimeoutMs, onChange: notify,
    async onNativeTimeout(requestId) {
      const prompt = session.snapshot().pendingLocalToolPermissionPrompts.find((entry) => entry.request.requestId === requestId);
      if (prompt && !disposed) await session.decideLocalToolPermission(prompt, 'deny_once');
    },
    postResult: (streamId, toolCallId, result) => options.host.postLocalToolResult(streamId, toolCallId, result),
  });
  const snapshot = (): ChatConversationSnapshot => {
    const current = session.snapshot();
    const active = [...current.messages].reverse().find((message) => message.role === 'assistant' && message._localStatus === 'processing');
    const checkpointState = checkpoints.snapshot();
    return {
      checkpointPrompt: checkpointState.prompt, checkpointBusy: checkpointState.busy, restorableMessageIds: checkpointState.messageIds,
      sessionId: current.sessionId, items: current.projectedTimelineItems, draft: current.draft,
      sending: state.sending, error: state.error, selectedModel: state.selectedModel,
      models: (catalog?.models ?? []) as ModelCatalogModel[],
      modelGroups: groupModelsByProvider((catalog?.providers ?? []) as ModelCatalogProvider[], (catalog?.models ?? []) as ModelCatalogModel[]),
      contextEntries: state.contextEntries.map((entry) => ({ ...entry })),
      generatedFiles: [...new Map(current.projectedTimelineItems.flatMap((item) => item.kind === 'message' ? []
        : extractGeneratedFileCardsFromEvents(item.segment.events)).map((card) => [card.jobId, card])).values()],
      attachments: buildAttachmentBandItems(current.attachments), permissions: [
        ...authorization.snapshot().filter((entry) => !current.pendingLocalToolPermissionPrompts.some((prompt) => `${prompt.streamId}:${prompt.toolCallId}` === entry.id)),
        ...current.pendingLocalToolPermissionPrompts.map((prompt) => ({ id: `native:${prompt.streamId}:${prompt.toolCallId}`, name: prompt.name, status: 'pending' as const })),
      ],
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
