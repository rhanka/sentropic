import { describe, it, expect } from 'vitest';
import { bboxOf, topCenter, cornerPin } from '../src/geometry';

const host = { width: 800, height: 600 };
const opts = { offset: 6, margin: 12 };

describe('bboxOf', () => {
  it('unions multiple rects', () => {
    const r1 = { x: 100, y: 100, width: 50, height: 50 };
    const r2 = { x: 300, y: 200, width: 50, height: 50 };
    expect(bboxOf([r1, r2])).toEqual({ minX: 100, maxX: 350, minY: 100, maxY: 250 });
  });
});

describe('topCenter', () => {
  it('returns the top-center of the bbox', () => {
    expect(topCenter([{ x: 100, y: 50, width: 200, height: 80 }])).toEqual({ x: 200, y: 50 });
  });
  it('degrades to a safe inset when there are no rings', () => {
    expect(topCenter([])).toEqual({ x: 8, y: 8 });
  });
});

describe('cornerPin', () => {
  it('prefers the top-right corner with an outward offset', () => {
    const rect = { x: 300, y: 200, width: 100, height: 80 }; // bbox 300..400 / 200..280
    expect(cornerPin([rect], host, opts)).toEqual({ x: 406, y: 194 }); // maxX+6, minY-6
  });

  it('falls back to top-left when top-right would leave the right edge', () => {
    const nearRight = { x: 760, y: 200, width: 30, height: 80 }; // TR x=796 > 788
    expect(cornerPin([nearRight], host, opts)).toEqual({ x: 754, y: 194 }); // minX-6, minY-6
  });

  it('falls back to a bottom corner when both top corners clear the top edge', () => {
    const nearTop = { x: 300, y: 4, width: 100, height: 60 }; // top y=-2 < margin
    expect(cornerPin([nearTop], host, opts)).toEqual({ x: 406, y: 70 }); // bottom-right: maxX+6, maxY+6
  });

  it('clamps inside the viewport when no corner fits', () => {
    const huge = { x: 0, y: 0, width: 800, height: 600 }; // fills the host
    const p = cornerPin([huge], host, opts);
    expect(p.x).toBeGreaterThanOrEqual(12);
    expect(p.x).toBeLessThanOrEqual(788);
    expect(p.y).toBeGreaterThanOrEqual(12);
    expect(p.y).toBeLessThanOrEqual(588);
  });

  it('uses the union bbox across multiple rings (group selection)', () => {
    const r1 = { x: 100, y: 100, width: 50, height: 50 };
    const r2 = { x: 300, y: 200, width: 50, height: 50 }; // union maxX=350, minY=100
    expect(cornerPin([r1, r2], host, opts)).toEqual({ x: 356, y: 94 });
  });

  it('degrades to a safe inset when there are no rings', () => {
    expect(cornerPin([], host, opts)).toEqual({ x: 8, y: 8 });
  });
});
