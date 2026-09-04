import type { Component, Snippet } from 'svelte';
import type { CommentHost } from '../comments/host.js';
import type { CommentThreadSummary } from '../comments/types.js';
import type { ChatGeneratedFileCard } from '../documents/generated-file-cards.js';
import type { ChatProjectedTimelineItem } from '../state/chatProjection.js';

export type ChatPanelShellTimelineItem = ChatProjectedTimelineItem<any, any>;

export type LocalToolPermissionPromptLike = {
  toolCallId: string;
  request: { toolName: string };
};

export type TodoRuntimeTaskLike = {
  id?: string;
  title: string;
  status?: string;
};

export type TodoRuntimePanelLike = {
  todoId: string;
  title: string;
  conflictMessage: string | null;
  tasks: TodoRuntimeTaskLike[];
};

export type ChatPanelShellProps = {
  mode?: 'ai' | 'comments';
  assistantLayout?: 'bubble' | 'plain';
  panelEl?: HTMLDivElement | null;
  // comments mode
  commentHost?: CommentHost | null;
  commentContextType?: string | null;
  commentContextId?: string | null;
  commentSectionKey?: string | null;
  commentSectionLabel?: string | null;
  commentThreadId?: string | null;
  commentLoading?: boolean;
  workspaceCanComment?: boolean;
  labels?: (key: string, opts?: Record<string, unknown>) => string;
  renderComposerSurfaceInput?: Snippet;
  renderComposerInput?: Snippet<
    [
      {
        value: string;
        disabled: boolean;
        placeholder: string;
        onChange: (v: string) => void;
        onKeyDown: (e: KeyboardEvent) => void;
      },
    ]
  >;
  renderThreadMenuPopover?: Snippet<
    [
      {
        threads: CommentThreadSummary[];
        currentThreadId: string | null;
        resolvedCount: number;
        showResolvedComments: boolean;
        onSelect: (t: CommentThreadSummary) => void;
        onNew: () => void;
        onToggleShowResolved: () => void;
        getThreadSectionLabel: (sectionKey: string | null) => string;
      },
    ]
  >;
  // AI timeline
  listEl?: HTMLDivElement | null;
  historyStageMeasureEl?: HTMLDivElement | null;
  onListScroll?: (event: Event) => void;
  projectedTimelineItems?: readonly ChatPanelShellTimelineItem[];
  stagedHistoryTimelineItems?: readonly ChatPanelShellTimelineItem[];
  messagesCount?: number;
  historyHydrationInFlight?: boolean;
  historyHydrationSwapPending?: boolean;
  sessionId?: string | null;
  editingMessageId?: string | null;
  renderEditForm?: Snippet<[{ messageId: string }]>;
  onStartEditMessage?: (message: { id: string }) => void;
  copyToClipboard?: (text: string, html?: string) => Promise<boolean>;
  renderMarkdownWithRefs?: (text: string) => string;
  isCopied?: (key: string) => boolean;
  markCopied?: (key: string) => void;
  showCheckpointRestoreForMessage?: (messageId: string) => boolean;
  openCheckpointPromptForMessage?: (messageId: string) => void;
  getCheckpointPreviewTitle?: (messageId: string) => string;
  getGeneratedFileCards?: (messageId: string) => ChatGeneratedFileCard[];
  onGeneratedFileCard?: (messageId: string, card: ChatGeneratedFileCard) => void;
  downloadGeneratedFile?: (card: ChatGeneratedFileCard) => void;
  useUnifiedActiveRunPresentation?: (message: unknown) => boolean;
  isSmoothStreamingModel?: (modelId: string | null | undefined) => boolean;
  loadRuntimeDetails?: (sessionId: string, messageId: string) => Promise<void>;
  onTodoRuntime?: (payload: never) => void;
  retryFromAssistant?: (messageId: string) => void;
  setFeedback?: (messageId: string, action: 'up' | 'down' | 'clear') => void;
  getAttachmentImageSrc?: (attachment: unknown) => string | Promise<string>;
  openLightbox?: (src: string, alt: string) => void;
  renderRestoreIcon?: Snippet;
  // banners + confirms
  pendingLocalToolPermissionPrompts?: readonly LocalToolPermissionPromptLike[];
  onLocalToolPermissionDecision?: (
    prompt: LocalToolPermissionPromptLike,
    decision: 'allow_once' | 'deny_once' | 'allow_always' | 'deny_always',
  ) => void | Promise<void>;
  resolvePermissionPromptDetails?: (
    prompt: LocalToolPermissionPromptLike,
  ) => Array<{ label: string; value: string }>;
  pendingCheckpointPrompt?: { kind: string } | null;
  checkpointActionInFlight?: boolean;
  confirmCheckpointPrompt?: () => void | Promise<void>;
  cancelCheckpointPrompt?: () => void | Promise<void>;
  errorMsg?: string | null;
  // todo-runtime panel + lightbox
  todoRuntimePanel?: TodoRuntimePanelLike | null;
  todoRuntimeCollapsed?: boolean;
  todoRuntimeDeleteInFlight?: boolean;
  pendingTodoRuntimeDeleteConfirm?: boolean;
  onDeleteTodoRuntime?: () => void | Promise<void>;
  isRuntimeTaskDone?: (status: string | undefined) => boolean;
  renderTrashIcon?: Snippet;
  renderChevronIcon?: Snippet<[{ collapsed: boolean }]>;
  lightboxImage?: { src: string; alt: string } | null;
  onCloseLightbox?: () => void;
  // composer
  input?: string;
  composerIsMultiline?: boolean;
  composerMaxHeight?: number;
  composerEl?: HTMLDivElement | null;
  onComposerKeyDown?: (event: KeyboardEvent) => void;
  onComposerPaste?: (event: ClipboardEvent) => void;
  onComposerChange?: (event: CustomEvent<{ value: string }>) => void;
  sessionDocsError?: string | null;
  googleDriveConnectionError?: string | null;
  attachmentBand?: readonly unknown[];
  getBandItemImageSrc?: (item: unknown) => string | Promise<string>;
  removeBandItem?: (item: unknown) => void | Promise<void>;
  renderComposerMenu?: Snippet;
  selectedModelSelectionKey?: string;
  modelCatalogGroups?: readonly unknown[];
  modelCatalogModels?: readonly unknown[];
  selectedModelWidthCh?: number;
  onModelChange?: (selection: { providerId: string; modelId: string }) => void;
  showStopButton?: boolean;
  stopInFlight?: boolean;
  onStopAssistant?: () => void;
  primaryDisabled?: boolean;
  primaryShowsSteer?: boolean;
  onPrimaryAction?: () => void;
  renderStopIcon?: Snippet;
  renderSteerIcon?: Snippet;
  renderSendIcon?: Snippet;
};

declare const ChatPanelShell: Component<ChatPanelShellProps>;
export default ChatPanelShell;
