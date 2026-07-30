import type { Component } from 'svelte';
import type { ChatPlacement } from '../state/chatPlacement.js';
import type { ChatPlacementMenu } from '../state/chatPlacementMenu.js';

export type ChatPlacementMenuButtonProps = {
  /**
   * The headless placement menu model (required) — owns the placement intent
   * and the contextual MODE (panel / floating / full screen) + SIDE groups.
   * The side group is omitted entirely in full screen, and the centre entry is
   * offered for floating placements only.
   */
  placementMenu: ChatPlacementMenu;
  /** Called after a selected placement has settled. */
  onPlacementChange?: (placement: ChatPlacement) => void;
  /** Optional host-owned drag lifecycle for the Move trigger. */
  dragCallbacks?: {
    start: (clientX: number, clientY: number) => void;
    move: (clientX: number, clientY: number) => void;
    end: (clientX: number, clientY: number) => void;
    cancel: () => void;
  };
  /** Extra class(es) appended to the trigger button (host styling passthrough). */
  class?: string;
};

/**
 * ChatPlacementMenuButton — the SINGLE placement control (surfaces L1c-menu).
 * Mount it in the HOST's own header toolbar next to the Close button; it
 * renders as a normal in-flow icon button, not an overlay. It replaces any
 * separate display-mode toggle: mode and side are both chosen from its one
 * grouped menu. ChatDock does not render it — hosts compose the two, driven
 * by the same `placementMenu` instance.
 */
declare const ChatPlacementMenuButton: Component<ChatPlacementMenuButtonProps>;

export default ChatPlacementMenuButton;
