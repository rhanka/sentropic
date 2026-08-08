import type { Component } from 'svelte';

export type ChatWidgetTab = 'chat' | 'queue' | 'comments';

export type ChatWidgetTabBarProps = {
  /** Currently active tab; drives the pressed/active styling. */
  activeTab: ChatWidgetTab;
  /** Hide the comments tab (e.g. plugin mode has no comments). */
  showCommentsTab?: boolean;
  chatTabLabel?: string;
  commentsTabLabel?: string;
  queueTabLabel?: string;
  /** Called when a tab is activated. */
  onSelect: (tab: ChatWidgetTab) => void;
  /** Package default look shows a jobs count badge; hosts may opt out. */
  showJobsBadge?: boolean;
  jobsBadgeCount?: number;
  /** 'extension' reproduces the app extension-main-tab styling (no badge); 'default' the package plain styling. */
  variant?: 'default' | 'extension';
  ariaLabel?: string;
};

declare const ChatWidgetTabBar: Component<ChatWidgetTabBarProps>;

export default ChatWidgetTabBar;
