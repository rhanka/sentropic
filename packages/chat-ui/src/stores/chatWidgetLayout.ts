import { writable } from 'svelte/store';

export type ChatWidgetDisplayMode = 'floating' | 'docked';
export type ChatWidgetDrawerSide = 'left' | 'right';

export type ChatWidgetLayoutState = {
  mode: ChatWidgetDisplayMode;
  isOpen: boolean; // true when the widget panel is visible (floating or docked)
  dockWidthCss: string; // e.g. "33vw" | "50vw" | "100vw"
  /**
   * Active side, published ONLY when a placement menu owns the placement and
   * commits a drawer. Absent on the legacy path (and on hosts that force the
   * mode), which therefore keeps its pre-existing payload untouched. Consumers
   * must treat `undefined` as the historical right-hand drawer.
   */
  drawerSide?: ChatWidgetDrawerSide;
};

export const chatWidgetLayout = writable<ChatWidgetLayoutState>({
  mode: 'floating',
  isOpen: false,
  dockWidthCss: '0px',
});
