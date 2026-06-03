import type { Component } from 'svelte';
import type { ChatUiLabelResolver, ChatUiWebHost } from '../hosts/createWebHost.js';
import type { ChatContextProvider } from '../state/chat-context.js';
import type { RendererRegistry } from '../renderers/registry.js';
import type { ModelCatalogGroup, ModelCatalogModel } from '../utils/model-selection.js';
import type { NormalizedPendingLocalToolCall } from '../utils/localToolStreamSync.js';

/**
 * Feature flags for ChatConversation.
 *
 * App-coupled concerns default OFF; pure chat concerns (steer/retry/stop) default ON.
 * All flags are opt-in.  Unsupported flags (comments/documents/jobs/workspaceScope)
 * are present for API compatibility — they register on the component surface and
 * will be activated when the matching adapters are wired in follow-up branches.
 */
export type ChatConversationFeatures = {
  /**
   * BR-38c attachment tray + lightbox + reference upload.
   * Default: false (BR-38c not yet landed).
   */
  attachments?: boolean;
  /** Comments mode / mention UI. Default: false. */
  comments?: boolean;
  /** Document-source menu / session docs. Default: false. */
  documents?: boolean;
  /** Queue / jobs panel. Default: false. */
  jobs?: boolean;
  /** Workspace RBAC gating. Default: false. */
  workspaceScope?: boolean;
  /** Steer action in composer. Default: true (pure, in primitives). */
  steer?: boolean;
  /** Retry / regenerate in message actions. Default: true (pure, in primitives). */
  retry?: boolean;
  /** Stop (abort) in composer. Default: true (pure, in primitives). */
  stop?: boolean;
};

export type ChatConversationProps = {
  /**
   * The web host adapter.  Provides transport, streamClient, labels, renderers,
   * and optional adapters (localTools, auth, navigation, storage).  Required.
   */
  host: ChatUiWebHost;
  /**
   * Session identifier.  When omitted the component renders an empty/idle state.
   * Full session-creation via host.transport.createSession is a deferred feature.
   */
  sessionId?: string;
  /**
   * Layout variant.  Default 'inline'.
   * 'docked' and 'floating' affect the outer wrapper CSS class.
   */
  layout?: 'inline' | 'docked' | 'floating';
  /**
   * i18n label resolver.  Falls back to host.labels, then to key passthrough.
   * No user-facing string is hardcoded in this component.
   */
  labels?: ChatUiLabelResolver;
  /**
   * Feature flags.  All app-coupled flags default OFF; steer/retry/stop default ON.
   */
  features?: ChatConversationFeatures;
  /**
   * Extra tool-result renderers.  Package defaults (from host.renderers) are always
   * active.  Caller-supplied renderers are supplemental (merged at render site).
   */
  renderers?: RendererRegistry;
  /** Flat model list for ModelSelector.  Shown when non-empty. */
  models?: ModelCatalogModel[];
  /** Provider-grouped model list for ModelSelector. */
  modelGroups?: ModelCatalogGroup[];
  /** Currently-selected model key ('provider::model'). */
  selectedModel?: string;
  /**
   * Context chip provider.  When supplied, ContextChips are rendered in the
   * composer header.  ContextChips are NOT shown when this is omitted.
   */
  contextProvider?: ChatContextProvider;
};

/**
 * ChatConversation — turnkey, app-agnostic 1:1 chat dialogue.
 *
 * Composes: ChatPanel -> ChatTimeline -> StreamMessage -> ChatComposer
 *           -> ModelSelector (when models supplied)
 *           -> MessageActions (per message)
 *           -> ContextChips (when contextProvider supplied)
 *
 * All app-coupled concerns default OFF.  No app store imported.
 * No hardcoded user-facing string — all labels go through the injected resolver.
 *
 * Baseline: chat-ui@0.6.0 (additive export; existing exports unchanged).
 */
declare const ChatConversation: Component<ChatConversationProps> & {
  /**
   * Parse pending local-tool calls from a stream status payload.
   * Exposed for testing and for the host's tool-handoff loop.
   * Full async execution wiring is a deferred follow-up (see BRANCH.md).
   */
  parseLocalToolCalls(
    streamId: string,
    sequence: number,
    data: unknown,
  ): NormalizedPendingLocalToolCall[];
};

export default ChatConversation;
