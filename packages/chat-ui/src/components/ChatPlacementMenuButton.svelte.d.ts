import type { Component } from 'svelte';
import type { ChatPlacementMenu } from '../state/chatPlacementMenu.js';

export type ChatPlacementMenuButtonProps = {
  /** The headless placement menu model (required) — owns intent + the 4-item menu surface. */
  placementMenu: ChatPlacementMenu;
  /** Extra class(es) appended to the trigger button (host styling passthrough). */
  class?: string;
};

/**
 * ChatPlacementMenuButton — "Move chat to…" placement menu affordance
 * (surfaces L1c-menu). Mount this in the HOST's own header toolbar (next to
 * a display-mode toggle / Close button); it renders as a normal in-flow icon
 * button, not an overlay. ChatDock does not render this — hosts compose it
 * alongside ChatDock, both driven by the same `placementMenu` instance.
 */
declare const ChatPlacementMenuButton: Component<ChatPlacementMenuButtonProps>;

export default ChatPlacementMenuButton;
