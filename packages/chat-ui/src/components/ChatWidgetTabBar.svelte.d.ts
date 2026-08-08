import { SvelteComponentTyped } from 'svelte';

export type ChatWidgetTab = 'chat' | 'queue' | 'comments';

export interface ChatWidgetTabBarProps {
  activeTab: ChatWidgetTab;
  showCommentsTab?: boolean;
  chatTabLabel?: string;
  commentsTabLabel?: string;
  queueTabLabel?: string;
  onSelect?: (tab: ChatWidgetTab) => void;
  showJobsBadge?: boolean;
  jobsBadgeCount?: number;
  variant?: 'default' | 'extension';
  ariaLabel?: string;
}

export default class ChatWidgetTabBar extends SvelteComponentTyped<
  ChatWidgetTabBarProps,
  Record<string, never>,
  Record<string, never>
> {}
