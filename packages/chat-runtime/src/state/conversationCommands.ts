import type { ChatConversationCommands } from '@sentropic/chat-runtime/conversation';
import type { DocumentHost } from '@sentropic/chat-runtime/documents';
import type { ChatCoreHost } from '../client/chat-core-host.js';
import { parseModelSelectionKey } from '@sentropic/chat-ui/utils/model-selection';
import type { ChatContextEntry } from './chat-context.js';
import type { ControllerSendPayload } from './chatLoopController.js';
import type { ChatSessionRuntime } from './chatSessionRuntime.js';
import type { createConversationDocuments } from './conversationDocuments.js';
import type { createConversationCheckpoints } from './conversationCheckpoints.js';

export type ConversationCommandState = {
  session: ChatSessionRuntime;
  host: ChatCoreHost;
  selectedModel: string;
  contextEntries: ChatContextEntry[];
  sending: boolean;
  error: string | null;
  documents?: DocumentHost;
  documentCommands: ReturnType<typeof createConversationDocuments>;
  checkpointCommands: ReturnType<typeof createConversationCheckpoints>;
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
