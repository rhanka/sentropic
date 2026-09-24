import type { Component, Snippet } from 'svelte';
import type { ChatWidgetPagerProps } from './ChatWidgetPager.svelte';

import type { ChatWidgetTab } from '../state/chatWidgetShell.js';
export type { ChatWidgetTab } from '../state/chatWidgetShell.js';

export type ChatWidgetProps = ChatWidgetPagerProps & {
  activeTab?: ChatWidgetTab;
  activeJobsCount?: number;
  failedJobsCount?: number;
  chatTabLabel?: string;
  commentsTabLabel?: string;
  queueTabLabel?: string;
  widgetLabel?: string;
  showCommentsTab?: boolean;
  tabBarVariant?: 'default' | 'extension';
  showJobsBadge?: boolean;
  onActiveTabChange?: (tab: ChatWidgetTab) => void;
  onPurgeJobs?: () => void | Promise<void>;
  /** Host auth/onboarding gate; invokes ready exactly once when content is allowed. */
  renderContentGate?: Snippet<[Snippet<[]>]>;
  renderJobsPanel?: Snippet<[]>;
  renderCommentsPanel?: Snippet<[]>;
  renderChatPanel?: Snippet<[]>;
  /** Header frame slots (L-C-shell S2): host content injected around the package-owned tab bar. */
  renderHeaderLeading?: Snippet<[]>;
  /** Providing this slot replaces the default Purge action, including on the Jobs tab. */
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
