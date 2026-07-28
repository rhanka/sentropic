import { describe, expect, it } from 'vitest';
import {
  createDragSession,
  createViewportDropZones,
  type DropZone,
} from '../src/state/chatPlacementDnd';
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

describe('chatPlacementDnd — viewport wiring', () => {
  it('creates only supported viewport zones and routes a left-edge drop to drawer.left.primary', () => {
    const zones = createViewportDropZones({
      viewport: { width: 1200, height: 800 },
      supported: [drawerLeft, drawerRight, floatingCenter, full],
    });
    const session = createDragSession({ zones, hitTolerancePx: 0 });

    expect(zones.map((zone) => zone.placement)).toContainEqual(drawerLeft);
    expect(zones.map((zone) => zone.placement)).not.toContainEqual({ kind: 'floating', anchor: 'left' });
    expect(session.hover(80, 200)).toEqual(drawerLeft);
    expect(session.end()).toEqual(drawerLeft);
  });
});

// ---------------------------------------------------------------------------
// The gesture grammar the owner specified: side edges dock, top middle
// maximises, everywhere else floats — and a docked panel detaches by being
// dragged straight down out of its own band.
// ---------------------------------------------------------------------------

describe('chatPlacementDnd — viewport gesture grammar', () => {
  const W = 1200;
  const H = 800;
  const floatingLeft: ChatPlacement = { kind: 'floating', anchor: 'left' };
  const floatingRight: ChatPlacement = { kind: 'floating', anchor: 'right' };
  const all = [drawerLeft, drawerRight, floatingLeft, floatingCenter, floatingRight, full];

  const at = (x: number, y: number) =>
    createDragSession({
      zones: createViewportDropZones({ viewport: { width: W, height: H }, supported: all }),
      hitTolerancePx: 0,
    }).hover(x, y);

  it('docks to a panel when dragged onto either side edge', () => {
    expect(at(W * 0.05, H * 0.4)).toEqual(drawerLeft);
    expect(at(W * 0.95, H * 0.4)).toEqual(drawerRight);
  });

  it('maximises when dragged to the top middle', () => {
    expect(at(W * 0.5, H * 0.05)).toEqual(full);
  });

  it('detaches a docked panel dragged straight down out of its band', () => {
    // Same x as the right edge band, but below it: the panel becomes floating.
    expect(at(W * 0.95, H * 0.4)).toEqual(drawerRight);
    expect(at(W * 0.95, H * 0.9)).toEqual(floatingRight);
  });

  it('floats in the column under the pointer everywhere else', () => {
    expect(at(W * 0.2, H * 0.5)).toEqual(floatingLeft);
    expect(at(W * 0.5, H * 0.5)).toEqual(floatingCenter);
    expect(at(W * 0.8, H * 0.5)).toEqual(floatingRight);
    expect(at(W * 0.1, H * 0.9)).toEqual(floatingLeft);
    expect(at(W * 0.9, H * 0.9)).toEqual(floatingRight);
  });

  it('leaves no point of the viewport without a destination', () => {
    for (let fx = 0.02; fx < 1; fx += 0.07) {
      for (let fy = 0.02; fy < 1; fy += 0.07) {
        expect(at(W * fx, H * fy), `no zone at ${fx.toFixed(2)},${fy.toFixed(2)}`).not.toBeNull();
      }
    }
  });
});
