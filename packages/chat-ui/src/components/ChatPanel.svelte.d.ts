import type { Component, Snippet } from 'svelte';
import type { ChatCoreTransport } from '../client/transport.js';
import type { StreamHubClient } from '../client/streamTypes.js';
import type { RendererRegistry } from '../renderers/registry.js';
import type {
  ChatUiLabelResolver,
  ChatUiWebHost,
} from '../hosts/createWebHost.js';

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
