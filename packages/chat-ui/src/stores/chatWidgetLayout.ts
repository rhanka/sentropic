import { writable } from 'svelte/store';

export type ChatWidgetDisplayMode = 'floating' | 'docked';
export type ChatWidgetDrawerSide = 'left' | 'right';

export type ChatWidgetLayoutState = {
  mode: ChatWidgetDisplayMode;
  isOpen: boolean; // true when the widget panel is visible (floating or docked)
  dockWidthCss: string; // e.g. "33vw" | "50vw" | "100vw"
  drawerSide?: ChatWidgetDrawerSide; // active side when mode is docked; legacy/forced dock defaults right
};

export const chatWidgetLayout = writable<ChatWidgetLayoutState>({
  mode: 'floating',
  isOpen: false,
  dockWidthCss: '0px',
  drawerSide: 'right',
});
