/**
 * PDF / document annotation anchor convention over the @sentropic/comments
 * `sectionKey` field.
 *
 * The comments package preserves `sectionKey` VERBATIM (see
 * `packages/comments/src/types.ts` — it is "Preserved verbatim from the live
 * column"), so this encode/decode pair is a HOST-ONLY convention: NO package
 * change and NO schema migration. A PDF anchor is carried as the comment
 * target's `sectionKey` on an `artifact`-kind target
 * (`{ kind: 'artifact', id: docId, sectionKey }`), where `docId` is the
 * `context_documents.id` primary key.
 *
 * Canonical sectionKey grammar:
 *   - page-level: `pdf:p<page>`                      (e.g. `pdf:p3`)
 *   - region:     `pdf:p<page>:bbox:<x0>,<y0>,<x1>,<y1>` (e.g. `pdf:p3:bbox:0,0.1,0.5,0.9`)
 *
 * `<page>` is 1-based. The bbox is a normalized `[x0, y0, x1, y1]` in `0..1`
 * with a TOP-LEFT origin (`x1 >= x0`, `y1 >= y0`).
 */

/** A resolved PDF annotation anchor. */
export type PdfAnchor = {
  /** 1-based page number (integer, >= 1). */
  page: number;
  /**
   * Optional normalized bounding box `[x0, y0, x1, y1]`, each coord in `0..1`,
   * top-left origin, with `x1 >= x0` and `y1 >= y0`. Absent => page-level anchor.
   */
  bbox?: [number, number, number, number];
};

const PAGE_ONLY_RE = /^pdf:p(\d+)$/;
const BBOX_RE =
  /^pdf:p(\d+):bbox:([0-9]*\.?[0-9]+),([0-9]*\.?[0-9]+),([0-9]*\.?[0-9]+),([0-9]*\.?[0-9]+)$/;

/** True when `n` is a finite number within the unit interval `0..1`. */
function isUnit(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

/** Throw a `RangeError` when `anchor` violates the PDF-anchor invariants. */
export function assertValidPdfAnchor(anchor: PdfAnchor): void {
  if (!Number.isInteger(anchor.page) || anchor.page < 1) {
    throw new RangeError(`pdf anchor: page must be an integer >= 1 (got ${anchor.page})`);
  }
  if (anchor.bbox !== undefined) {
    const [x0, y0, x1, y1] = anchor.bbox;
    if (![x0, y0, x1, y1].every(isUnit)) {
      throw new RangeError(
        `pdf anchor: bbox coords must be finite and within 0..1 (got ${anchor.bbox.join(',')})`,
      );
    }
    if (x1 < x0 || y1 < y0) {
      throw new RangeError(
        `pdf anchor: bbox must satisfy x1>=x0 and y1>=y0 (got ${anchor.bbox.join(',')})`,
      );
    }
  }
}

/** True when `anchor` satisfies the PDF-anchor invariants. */
export function isValidPdfAnchor(anchor: PdfAnchor): boolean {
  try {
    assertValidPdfAnchor(anchor);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encode a `PdfAnchor` to its canonical `sectionKey` string. Throws (via
 * `assertValidPdfAnchor`) when the anchor is out of range.
 */
export function encodePdfAnchor(anchor: PdfAnchor): string {
  assertValidPdfAnchor(anchor);
  if (anchor.bbox === undefined) {
    return `pdf:p${anchor.page}`;
  }
  const [x0, y0, x1, y1] = anchor.bbox;
  return `pdf:p${anchor.page}:bbox:${x0},${y0},${x1},${y1}`;
}

/** Cheap guard: does `sectionKey` look like a PDF anchor key? */
export function isPdfAnchorKey(sectionKey: string | null | undefined): boolean {
  return typeof sectionKey === 'string' && sectionKey.startsWith('pdf:p');
}

/**
 * Decode a canonical `sectionKey` to a `PdfAnchor`, or `null` when it is not a
 * valid PDF anchor (non-`pdf:` key, malformed grammar, or out-of-range coords).
 */
export function decodePdfAnchor(sectionKey: string): PdfAnchor | null {
  const pageOnly = PAGE_ONLY_RE.exec(sectionKey);
  if (pageOnly) {
    const anchor: PdfAnchor = { page: Number(pageOnly[1]) };
    return isValidPdfAnchor(anchor) ? anchor : null;
  }
  const withBox = BBOX_RE.exec(sectionKey);
  if (withBox) {
    const anchor: PdfAnchor = {
      page: Number(withBox[1]),
      bbox: [Number(withBox[2]), Number(withBox[3]), Number(withBox[4]), Number(withBox[5])],
    };
    return isValidPdfAnchor(anchor) ? anchor : null;
  }
  return null;
}
