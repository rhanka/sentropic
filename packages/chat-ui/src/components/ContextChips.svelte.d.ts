import type { Component } from 'svelte';
import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
import type { ChatContextEntry, ChatContextProvider } from '@sentropic/chat-runtime/state/chat-context';

export type ContextChipsProps = {
  /**
   * Host-injected provider that emits the current chip list.
   * Defaults to the no-op provider (empty list).
   */
  provider?: ChatContextProvider;
  /** i18n / label resolver injected by the host. */
  labels?: ChatUiLabelResolver;
  /**
   * Called when the user clicks the remove (×) button on a chip.
   * If not provided, no remove button is rendered.
   */
  onRemove?: (entry: ChatContextEntry) => void;
  /**
   * Called when the user clicks on a chip (not the remove button).
   * Optional — chips are non-interactive when not provided.
   */
  onChipClick?: (entry: ChatContextEntry) => void;
};

declare const ContextChips: Component<ContextChipsProps>;

export default ContextChips;
