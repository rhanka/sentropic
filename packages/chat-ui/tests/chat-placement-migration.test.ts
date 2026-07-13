import { describe, expect, it } from 'vitest';
import {
  displayModeToPlacement,
  placementToDisplayMode,
} from '../src/state/chatPlacementMigration';
import type { ChatWidgetDisplayMode } from '../src/stores/chatWidgetLayout';
import type { ChatPlacement } from '../src/state/chatPlacement';

describe('chatPlacementMigration — displayModeToPlacement', () => {
  it('maps floating to a right-anchored floating placement', () => {
    expect(displayModeToPlacement('floating')).toEqual({
      kind: 'floating',
      anchor: 'right',
    });
  });

  it('maps docked to a right-anchored primary drawer placement', () => {
    expect(displayModeToPlacement('docked')).toEqual({
      kind: 'drawer',
      side: 'right',
      occupancy: 'primary',
    });
  });
});

describe('chatPlacementMigration — placementToDisplayMode', () => {
  it('maps floating.right back to floating', () => {
    const p: ChatPlacement = { kind: 'floating', anchor: 'right' };
    expect(placementToDisplayMode(p)).toBe('floating');
  });

  it('maps drawer.right.primary back to docked', () => {
    const p: ChatPlacement = { kind: 'drawer', side: 'right', occupancy: 'primary' };
    expect(placementToDisplayMode(p)).toBe('docked');
  });

  it('returns null for placements outside the legacy pair', () => {
    const nonLegacy: ChatPlacement[] = [
      { kind: 'floating', anchor: 'center' },
      { kind: 'floating', anchor: 'left' },
      { kind: 'drawer', side: 'left', occupancy: 'primary' },
      { kind: 'drawer', side: 'right', occupancy: 'stacked', stickiness: 'top' },
      { kind: 'drawer', side: 'right', occupancy: 'stacked', stickiness: 'bottom' },
      { kind: 'full' },
    ];
    for (const p of nonLegacy) {
      expect(placementToDisplayMode(p)).toBeNull();
    }
  });
});

describe('chatPlacementMigration — round-trip', () => {
  const modes: ChatWidgetDisplayMode[] = ['floating', 'docked'];

  it.each(modes)('placementToDisplayMode(displayModeToPlacement(%s)) === %s', (mode) => {
    expect(placementToDisplayMode(displayModeToPlacement(mode))).toBe(mode);
  });
});
