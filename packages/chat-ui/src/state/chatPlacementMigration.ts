/**
 * chatPlacementMigration — pure bridge between the legacy chat display mode
 * and the placement taxonomy (SPEC_EVOL_CHAT_SURFACES).
 *
 * Framework-neutral (no Svelte, no DOM): behavior-preserving translation only.
 * Lets host-wiring migrate `floating|docked` onto `ChatPlacement` incrementally
 * without touching any component. The legacy taxonomy maps onto exactly two
 * placement ids (`floating.right`, `drawer.right.primary`); every other
 * placement has no legacy equivalent.
 */

import type { ChatWidgetDisplayMode } from '../stores/chatWidgetLayout.js';
import type { ChatPlacement } from './chatPlacement.js';
import { placementId } from './chatPlacement.js';

/** Legacy 'docked' means a right-anchored panel (see chatWidgetLayout.ts). */
export function displayModeToPlacement(mode: ChatWidgetDisplayMode): ChatPlacement {
  return mode === 'floating'
    ? { kind: 'floating', anchor: 'right' }
    : { kind: 'drawer', side: 'right', occupancy: 'primary' };
}

/** Inverse of displayModeToPlacement; null for any placement outside the legacy pair. */
export function placementToDisplayMode(p: ChatPlacement): ChatWidgetDisplayMode | null {
  switch (placementId(p)) {
    case 'floating.right':
      return 'floating';
    case 'drawer.right.primary':
      return 'docked';
    default:
      return null;
  }
}

/**
 * Maps every menu placement to the legacy two-mode preference used by hosts
 * while they progressively adopt the placement controller.
 */
export function placementToLegacyDisplayMode(p: ChatPlacement): ChatWidgetDisplayMode {
  return p.kind === 'drawer' ? 'docked' : 'floating';
}
