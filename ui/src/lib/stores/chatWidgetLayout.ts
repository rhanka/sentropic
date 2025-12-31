import { writable } from 'svelte/store';

export type ChatWidgetDisplayMode = 'floating' | 'docked';

export type ChatWidgetLayoutState = {
  mode: ChatWidgetDisplayMode;
  isOpen: boolean;
  dockWidthCss: string; // e.g. "33vw" | "50vw" | "100vw"
};

export const chatWidgetLayout = writable<ChatWidgetLayoutState>({
  mode: 'floating',
  isOpen: false,
  dockWidthCss: '0px'
});


