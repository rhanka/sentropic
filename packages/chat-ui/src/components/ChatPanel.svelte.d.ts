import type { Component, Snippet } from 'svelte';
import type { ChatCoreTransport } from '@sentropic/chat-runtime/client/transport';
import type { StreamHubClient } from '@sentropic/chat-runtime/client/streamTypes';
import type { RendererRegistry } from '../renderers/registry.js';
import type {
  ChatUiLabelResolver,
  ChatUiWebHost,
} from '@sentropic/chat-runtime/hosts/createWebHost';

export type ChatPanelProps = {
  host?: ChatUiWebHost;
  transport?: ChatCoreTransport;
  streamClient?: StreamHubClient;
  contextProvider?: unknown;
  rendererRegistry?: RendererRegistry;
  labels?: ChatUiLabelResolver;
  featureFlags?: Record<string, boolean>;
  renderShell?: Snippet<[]>;
  renderHeader?: Snippet<[]>;
  renderTimeline?: Snippet<[]>;
  renderComposer?: Snippet<[]>;
};

declare const ChatPanel: Component<ChatPanelProps>;

export default ChatPanel;
