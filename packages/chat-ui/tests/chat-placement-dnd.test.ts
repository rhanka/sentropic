import { describe, expect, it } from 'vitest';
import { createDragSession, type DropZone } from '../src/state/chatPlacementDnd';
import type { ChatPlacement } from '../src/state/chatPlacement';

const drawerRight: ChatPlacement = { kind: 'drawer', side: 'right', occupancy: 'primary' };
const drawerLeft: ChatPlacement = { kind: 'drawer', side: 'left', occupancy: 'primary' };
const floatingCenter: ChatPlacement = { kind: 'floating', anchor: 'center' };
const full: ChatPlacement = { kind: 'full' };

describe('chatPlacementDnd — hit-testing', () => {
  it('hover returns the placement of the zone containing the point', () => {
    const zones: DropZone[] = [
      { placement: drawerRight, rect: { x: 100, y: 0, width: 50, height: 200 } },
    ];
    const session = createDragSession({ zones });
    expect(session.hover(120, 50)).toEqual(drawerRight);
  });

  it('treats a point just inside the default 8px tolerance margin as a hit', () => {
    const zones: DropZone[] = [
      { placement: drawerRight, rect: { x: 100, y: 0, width: 50, height: 200 } },
    ];
    const session = createDragSession({ zones });
    // 5px left of the rect's left edge — within the default 8px tolerance
    expect(session.hover(95, 50)).toEqual(drawerRight);
  });

  it('returns null for a point outside every zone (beyond tolerance)', () => {
    const zones: DropZone[] = [
      { placement: drawerRight, rect: { x: 100, y: 0, width: 50, height: 200 } },
    ];
    const session = createDragSession({ zones, hitTolerancePx: 4 });
    expect(session.hover(50, 50)).toBeNull();
  });

  it('respects a custom hitTolerancePx', () => {
    const zones: DropZone[] = [{ placement: full, rect: { x: 0, y: 0, width: 100, height: 100 } }];
    const zeroTolerance = createDragSession({ zones, hitTolerancePx: 0 });
    expect(zeroTolerance.hover(105, 50)).toBeNull();

    const wideTolerance = createDragSession({ zones, hitTolerancePx: 20 });
    expect(wideTolerance.hover(105, 50)).toEqual(full);
  });

  it('picks the smallest-area zone when zones overlap', () => {
    const zones: DropZone[] = [
      { placement: full, rect: { x: 0, y: 0, width: 400, height: 400 } },
      { placement: floatingCenter, rect: { x: 150, y: 150, width: 20, height: 20 } },
    ];
    const session = createDragSession({ zones });
    // inside both the large `full` zone and the small nested `floatingCenter` zone
    expect(session.hover(160, 160)).toEqual(floatingCenter);
    // inside only the large zone
    expect(session.hover(10, 10)).toEqual(full);
  });

  it('end() returns the last hovered placement as the drop target', () => {
    const zones: DropZone[] = [{ placement: drawerLeft, rect: { x: 0, y: 0, width: 50, height: 200 } }];
    const session = createDragSession({ zones });
    session.hover(20, 50);
    expect(session.end()).toEqual(drawerLeft);
  });

  it('end() returns null when the pointer is outside all zones at drop', () => {
    const zones: DropZone[] = [{ placement: drawerLeft, rect: { x: 0, y: 0, width: 50, height: 200 } }];
    const session = createDragSession({ zones });
    session.hover(20, 50);
    session.hover(5000, 5000);
    expect(session.end()).toBeNull();
  });

  it('end() is null before any hover call', () => {
    const zones: DropZone[] = [{ placement: drawerLeft, rect: { x: 0, y: 0, width: 50, height: 200 } }];
    const session = createDragSession({ zones });
    expect(session.end()).toBeNull();
  });

  it('tracks the drop target correctly across zone -> null -> zone hover movement', () => {
    const zones: DropZone[] = [
      { placement: drawerLeft, rect: { x: 0, y: 0, width: 50, height: 200 } },
      { placement: drawerRight, rect: { x: 500, y: 0, width: 50, height: 200 } },
    ];
    const session = createDragSession({ zones });

    expect(session.hover(20, 50)).toEqual(drawerLeft);
    expect(session.hover(5000, 5000)).toBeNull();
    expect(session.end()).toBeNull();

    expect(session.hover(520, 50)).toEqual(drawerRight);
    expect(session.end()).toEqual(drawerRight);
  });

  it('zones() returns the configured zones with their original (non-expanded) rects', () => {
    const zones: DropZone[] = [{ placement: drawerLeft, rect: { x: 0, y: 0, width: 50, height: 200 } }];
    const session = createDragSession({ zones });
    expect(session.zones()).toEqual(zones);
  });
});
