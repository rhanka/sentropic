import { writable } from 'svelte/store';

// ChatWidgetDisplayMode moved to @sentropic/chat-ui-core/state/chatWidgetShell (A1a extraction).
// Re-exported here to keep the ./stores/chatWidgetLayout subpath contract intact.
export type { ChatWidgetDisplayMode } from '@sentropic/chat-ui-core/state/chatWidgetShell';
import type { ChatWidgetDisplayMode } from '@sentropic/chat-ui-core/state/chatWidgetShell';

export type ChatWidgetLayoutState = {
  mode: ChatWidgetDisplayMode;
  isOpen: boolean; // true when the widget panel is visible (floating or docked)
  dockWidthCss: string; // e.g. "33vw" | "50vw" | "100vw"
};

export const chatWidgetLayout = writable<ChatWidgetLayoutState>({
  mode: 'floating',
  isOpen: false,
  dockWidthCss: '0px'
});
