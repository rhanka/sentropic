import type { ChatProjectedTimelineItem } from '@sentropic/chat-runtime/state/chatProjection';
import type { ChatSessionRuntimeMessage } from '@sentropic/chat-runtime/state/chatSessionRuntime';
import type { ModelCatalogGroup, ModelCatalogModel } from '@sentropic/chat-runtime/utils/model-selection';
import type { ChatContextEntry, ReadableStore } from '@sentropic/chat-runtime/state/chat-context';
import type { UnifiedAttachmentItem, ChatGeneratedFileCard } from './documents/types.js';

/** Data-only port consumed by the conversation view; no runtime lifecycle is exposed. */
export type ConversationPermission = {
  id: string;
  name: string;
  status: 'pending' | 'denied' | 'approved';
};

export type ChatConversationSnapshot = {
  sessionId: string;
  items: readonly ChatProjectedTimelineItem<ChatSessionRuntimeMessage, unknown>[];
  draft: string;
  sending: boolean;
  error: string | null;
  selectedModel: string;
  models: ModelCatalogModel[];
  modelGroups: ModelCatalogGroup[];
  contextEntries: ChatContextEntry[];
  attachments: UnifiedAttachmentItem[];
  generatedFiles: ChatGeneratedFileCard[];
  permissions: ConversationPermission[];
  activeStreamId: string | null;
  activeMessageId: string | null;
};

export type ChatConversationCommands = {
  setDraft(value: string): void;
  send(): Promise<void>;
  retry(messageId: string): Promise<void>;
  stop(messageId: string): Promise<void>;
  edit(messageId: string, content: string): Promise<void>;
  setFeedback(messageId: string, vote: 'up' | 'down' | 'clear'): Promise<void>;
  steer(): Promise<void>;
  selectModel(value: string): void;
  toggleContext(key: string, enabled: boolean): void;
  attachFiles(files: File[], source?: 'upload' | 'paste'): Promise<void>;
  retryAttachment(id: string): Promise<void>;
  downloadGeneratedFile(card: ChatGeneratedFileCard): Promise<void>;
  removeAttachment(id: string): Promise<void>;
  decidePermission(id: string, allow: boolean): Promise<void>;
};

export type ChatConversationSnapshots = ReadableStore<ChatConversationSnapshot>;
