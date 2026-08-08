import type { Component, Snippet } from 'svelte';

export type ChatWidgetTab = 'chat' | 'queue' | 'comments';

export type ChatWidgetProps = {
  activeTab?: ChatWidgetTab;
  activeJobsCount?: number;
  failedJobsCount?: number;
  chatTabLabel?: string;
  commentsTabLabel?: string;
  queueTabLabel?: string;
  widgetLabel?: string;
  showCommentsTab?: boolean;
  onActiveTabChange?: (tab: ChatWidgetTab) => void;
  onPurgeJobs?: () => void | Promise<void>;
  renderShell?: Snippet<[]>;
  renderJobsPanel?: Snippet<[]>;
  renderCommentsPanel?: Snippet<[]>;
  renderChatPanel?: Snippet<[]>;
  /** Header frame slots (L-C-shell S2): host content injected around the package-owned tab bar. */
  renderHeaderLeading?: Snippet<[]>;
  renderHeaderActions?: Snippet<[]>;
  /** Drag-grip contract for the header element; host owns the drag session. */
  headerGrip?: {
    enabled?: boolean;
    dragging?: boolean;
    onPointerDown?: (event: PointerEvent) => void;
  };
};

declare const ChatWidget: Component<ChatWidgetProps>;

export default ChatWidget;
