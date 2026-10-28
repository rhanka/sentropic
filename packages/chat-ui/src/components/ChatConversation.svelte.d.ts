import type { Component, Snippet } from 'svelte';
import type { ChatConversationSnapshots, ChatConversationCommands } from '../conversation.js';
import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';

export type ChatConversationFeatures = {
  attachments?: boolean;
  comments?: boolean;
  documents?: boolean;
  jobs?: boolean;
  workspaceScope?: boolean;
  steer?: boolean;
  retry?: boolean;
  stop?: boolean;
};

export type ChatConversationProps = {
  snapshots: ChatConversationSnapshots;
  commands: ChatConversationCommands;
  labels?: ChatUiLabelResolver;
  layout?: 'inline' | 'docked' | 'floating';
  features?: ChatConversationFeatures;
  renderComments?: Snippet;
  renderDocuments?: Snippet;
  renderJobs?: Snippet;
  renderWorkspaceScope?: Snippet;
};

/** Conversation view only. The host owns the lifetime of its injected runtime. */
declare const ChatConversation: Component<ChatConversationProps>;
export default ChatConversation;
