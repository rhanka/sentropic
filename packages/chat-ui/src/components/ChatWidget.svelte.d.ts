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
};

declare const ChatWidget: Component<ChatWidgetProps>;

export default ChatWidget;
