import type { SvelteComponent } from 'svelte';
import type { ChatUiLabelResolver } from '../hosts/createWebHost.js';
import type { ChatContextEntry } from '../state/chat-context.js';

export type ChatContextPickerProps = {
  /** List of context entries to render. */
  entries?: ChatContextEntry[];
  /**
   * Icon resolver — called with each entry; should return the icon component
   * (e.g. a @lucide/svelte icon class) or undefined.
   */
  iconFor?: (e: ChatContextEntry) => unknown;
  /**
   * Called when the user clicks a context entry button.
   * The host toggles active state and persists prefs.
   */
  onToggle?: (e: ChatContextEntry) => void;
  /** i18n / label resolver injected by the host. */
  labels?: ChatUiLabelResolver;
  /**
   * Inline style for the container's max-height (e.g. 'max-height:10rem').
   * Defaults to 'max-height:10rem' when not supplied.
   */
  maxHeightStyle?: string;
};

declare class ChatContextPicker extends SvelteComponent<
  ChatContextPickerProps,
  Record<string, never>,
  { 'leading': Record<string, never> }
> {}

export default ChatContextPicker;
