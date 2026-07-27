import { describe, expect, it } from 'vitest';

import type { ChatPlacement } from '../src/state/chatPlacement.js';
import { placementContainerClasses } from '../src/state/chatPlacementClasses.js';

const DOCK_WIDTH_CSS = '420px';
const DOCKED_RIGHT_PRIMARY: ChatPlacement = {
  kind: 'drawer',
  side: 'right',
  occupancy: 'primary',
};
const DOCKED_LEFT_PRIMARY: ChatPlacement = {
  kind: 'drawer',
  side: 'left',
  occupancy: 'primary',
};

const FLOATING_RIGHT: ChatPlacement = {
  kind: 'floating',
  anchor: 'right',
};

const FLOATING_LEFT: ChatPlacement = { kind: 'floating', anchor: 'left' };
const FLOATING_CENTER: ChatPlacement = { kind: 'floating', anchor: 'center' };
const FULL: ChatPlacement = { kind: 'full' };

describe('chatPlacementClasses — dialog container class/style mapping', () => {
  it('preserves drawer.right.primary behavior', () => {
    const result = placementContainerClasses(DOCKED_RIGHT_PRIMARY, { dockWidthCss: DOCK_WIDTH_CSS });
    expect(result).toEqual({
      className:
        'chat-dock-shell fixed top-0 right-0 bottom-0 z-50 bg-white border-l border-gray-200 flex flex-col',
      style: `width: ${DOCK_WIDTH_CSS};`,
    });
  });

  it('maps drawer.left.primary to the left edge with a right border at the configured dock width', () => {
    const result = placementContainerClasses(DOCKED_LEFT_PRIMARY, { dockWidthCss: DOCK_WIDTH_CSS });
    expect(result).toEqual({
      className:
        'chat-dock-shell fixed top-0 left-0 bottom-0 z-50 bg-white border-r border-gray-200 flex flex-col',
      style: `width: ${DOCK_WIDTH_CSS};`,
    });
  });

  it('preserves floating.right behavior', () => {
    const result = placementContainerClasses(FLOATING_RIGHT);
    expect(result).toEqual({
      className:
        'chat-dock-shell fixed inset-x-0 bottom-0 z-50 bg-white shadow-2xl border border-gray-200 flex flex-col h-[85dvh] max-h-[calc(100dvh-1rem)] rounded-t-xl sm:fixed sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[70vh] sm:max-h-[calc(100vh-2rem)] sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-lg',
      style: '',
    });
  });

  it('maps floating.left to a left-anchored floating class set', () => {
    const result = placementContainerClasses(FLOATING_LEFT);
    expect(result.style).toBe('');
    expect(result.className).toContain('fixed');
    expect(result.className).toContain('sm:fixed');
    expect(result.className).toContain('sm:left-4');
    expect(result.className).toContain('sm:bottom-4');
    expect(result.className).not.toContain('sm:right-4');
  });

  it('maps floating.center to a centered class set', () => {
    const result = placementContainerClasses(FLOATING_CENTER);
    expect(result.style).toBe('');
    expect(result.className).toContain('sm:fixed');
    expect(result.className).toContain('sm:bottom-4');
    expect(result.className).toContain('sm:left-1/2');
    expect(result.className).toContain('sm:-translate-x-1/2');
  });

  it('maps full to inset viewport panel classes', () => {
    const result = placementContainerClasses(FULL);
    expect(result.style).toBe('');
    expect(result.className).toContain('fixed');
    expect(result.className).toContain('inset-0');
    expect(result.className).not.toMatch(/\brounded/);
  });

  it('keeps each supported placement class set distinct', () => {
    const left = placementContainerClasses(FLOATING_LEFT).className;
    const center = placementContainerClasses(FLOATING_CENTER).className;
    const full = placementContainerClasses(FULL).className;
    const right = placementContainerClasses(FLOATING_RIGHT).className;
    const docked = placementContainerClasses(DOCKED_RIGHT_PRIMARY, { dockWidthCss: DOCK_WIDTH_CSS }).className;

    const dockedLeft = placementContainerClasses(DOCKED_LEFT_PRIMARY, { dockWidthCss: DOCK_WIDTH_CSS }).className;

    expect(new Set([left, center, full, right, docked, dockedLeft]).size).toBe(6);
  });
});
