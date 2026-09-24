import type { Component, Snippet } from 'svelte';
import type { AgentsListProps } from './AgentsList.svelte';

export type ChatWidgetPagerProps = {
  agentsView?: 'list' | 'conversation';
  canAgentsListBeDefaultView?: boolean;
  agentsList?: AgentsListProps;
  renderAgentsListHeader?: Snippet<[]>;
  renderConversationHeader?: Snippet<[]>;
  renderChatPanel?: Snippet<[]>;
  agentsViewAnnouncement?: string;
};

declare const ChatWidgetPager: Component<ChatWidgetPagerProps>;
export default ChatWidgetPager;
