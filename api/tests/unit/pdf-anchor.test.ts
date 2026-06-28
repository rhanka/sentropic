import { describe, it, expect } from 'vitest';
import {
  assertValidPdfAnchor,
  decodePdfAnchor,
  encodePdfAnchor,
  isPdfAnchorKey,
  isValidPdfAnchor,
  type PdfAnchor,
} from '../../src/services/comments/pdf-anchor';

describe('pdf-anchor sectionKey convention', () => {
  it('encodes a page-only anchor', () => {
    expect(encodePdfAnchor({ page: 1 })).toBe('pdf:p1');
    expect(encodePdfAnchor({ page: 42 })).toBe('pdf:p42');
  });

  it('encodes a bbox anchor', () => {
    expect(encodePdfAnchor({ page: 3, bbox: [0, 0.1, 0.5, 0.9] })).toBe('pdf:p3:bbox:0,0.1,0.5,0.9');
  });

  it('round-trips page-only and bbox anchors', () => {
    const cases: PdfAnchor[] = [
      { page: 1 },
      { page: 7 },
      { page: 2, bbox: [0, 0, 1, 1] },
      { page: 5, bbox: [0.125, 0.25, 0.875, 0.75] },
      { page: 10, bbox: [0.5, 0.5, 0.5, 0.5] }, // degenerate point is valid (x1>=x0,y1>=y0)
    ];
    for (const a of cases) {
      expect(decodePdfAnchor(encodePdfAnchor(a))).toEqual(a);
    }
  });

  it('detects pdf anchor keys', () => {
    expect(isPdfAnchorKey('pdf:p1')).toBe(true);
    expect(isPdfAnchorKey('pdf:p1:bbox:0,0,1,1')).toBe(true);
    expect(isPdfAnchorKey('description')).toBe(false);
    expect(isPdfAnchorKey('matrix.cell.1.2')).toBe(false);
    expect(isPdfAnchorKey(null)).toBe(false);
    expect(isPdfAnchorKey(undefined)).toBe(false);
  });

  it('returns null for non-pdf or malformed section keys', () => {
    expect(decodePdfAnchor('description')).toBeNull();
    expect(decodePdfAnchor('matrix.cell.1.2')).toBeNull();
    expect(decodePdfAnchor('pdf:p')).toBeNull();
    expect(decodePdfAnchor('pdf:p0')).toBeNull(); // page < 1
    expect(decodePdfAnchor('pdf:p1:bbox:0,0,1')).toBeNull(); // too few coords
    expect(decodePdfAnchor('pdf:p1:bbox:0,0,2,1')).toBeNull(); // out of 0..1
    expect(decodePdfAnchor('pdf:p1:bbox:0.5,0,0.4,1')).toBeNull(); // x1 < x0
    expect(decodePdfAnchor('pdf:p1:bbox:0,0.5,1,0.4')).toBeNull(); // y1 < y0
  });

  it('validates anchor invariants (finite, 0..1, x1>=x0, y1>=y0, page>=1)', () => {
    expect(isValidPdfAnchor({ page: 1 })).toBe(true);
    expect(isValidPdfAnchor({ page: 0 })).toBe(false);
    expect(isValidPdfAnchor({ page: -1 })).toBe(false);
    expect(isValidPdfAnchor({ page: 1.5 })).toBe(false);
    expect(isValidPdfAnchor({ page: 1, bbox: [0, 0, 1, 1] })).toBe(true);
    expect(isValidPdfAnchor({ page: 1, bbox: [-0.1, 0, 1, 1] })).toBe(false);
    expect(isValidPdfAnchor({ page: 1, bbox: [0, 0, 1, 1.2] })).toBe(false);
    expect(isValidPdfAnchor({ page: 1, bbox: [0.6, 0, 0.5, 1] })).toBe(false);
    expect(isValidPdfAnchor({ page: 1, bbox: [0, 0.6, 1, 0.5] })).toBe(false);
    expect(isValidPdfAnchor({ page: 1, bbox: [Number.NaN, 0, 1, 1] })).toBe(false);
    expect(isValidPdfAnchor({ page: 1, bbox: [0, 0, Number.POSITIVE_INFINITY, 1] })).toBe(false);
  });

  it('throws on encode of an invalid anchor', () => {
    expect(() => encodePdfAnchor({ page: 0 })).toThrow(RangeError);
    expect(() => encodePdfAnchor({ page: 1, bbox: [0, 0, 2, 1] })).toThrow(RangeError);
    expect(() => assertValidPdfAnchor({ page: 1, bbox: [0.6, 0, 0.5, 1] })).toThrow(RangeError);
  });
});
