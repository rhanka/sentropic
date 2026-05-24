import type { Component, Snippet } from 'svelte';
import type { ChatProjectedTimelineItem } from '../state/chatProjection.js';

export type ChatTimelineItem = ChatProjectedTimelineItem<any, any>;

export type ChatTimelineProps = {
  items: readonly ChatTimelineItem[];
  renderUserMessage: Snippet<[ChatTimelineItem]>;
  renderMessageAttachments?: Snippet<[ChatTimelineItem]>;
  renderAssistantSegment: Snippet<[ChatTimelineItem]>;
  renderRuntimeSegment: Snippet<[ChatTimelineItem]>;
};

declare const ChatTimeline: Component<ChatTimelineProps>;

export default ChatTimeline;
