import vm from 'node:vm';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  PageBreak as DocxPageBreak,
} from 'docx';
import * as pptxgenjsNamespace from 'pptxgenjs';

import { documentGenerateSkill } from '../../src/bundles/foundation/document_generate/index.js';
import { createDocumentGenerateHandler } from '../../src/bundles/foundation/document_generate/handler.js';
import { createIsolatedVmRuntime } from '../../src/sandbox/runtime.js';
import type { SandboxRuntime } from '../../src/sandbox/runtime.js';

// ---------------------------------------------------------------------------
// Legacy helper reimplementation for byte-stability comparison.
//
// These functions are a LINE-FOR-LINE copy of the helpers exposed by
// `api/src/services/docx-freeform-helpers.ts` (which the launch packet marks
// READ-ONLY). They run synchronously inside a `node:vm` context, matching the
// legacy `generateFreeformDocx` execution path. The bridge helpers in
// `packages/skills/src/sandbox/docx-host-bridge.ts` reproduce the SAME logic
// host-side; this test proves the bridge's `Document` output is byte-equal to
// the legacy path's `Document` output when packed via `docx.Packer.toBuffer`.
// ---------------------------------------------------------------------------

const DEFAULT_FONT = 'Arial';
const DEFAULT_FONT_SIZE = 24;
const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const PAGE_MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN;

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

type LegacyDocOpts = { styles?: Record<string, unknown> };
type LegacyHeadingOpts = {
  color?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
};
type LegacyParagraphOpts = {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  spacing?: { before?: number; after?: number };
  indent?: { left?: number; firstLine?: number };
};

function legacyDoc(children: (Paragraph | Table)[], opts?: LegacyDocOpts): Document {
  return new Document({
    styles: (opts?.styles as Document['styles']) ?? {
      default: {
        document: { run: { font: DEFAULT_FONT, size: DEFAULT_FONT_SIZE } },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: DEFAULT_FONT },
          paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 28, bold: true, font: DEFAULT_FONT },
          paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: DEFAULT_FONT },
          paragraph: { spacing: { before: 120, after: 120 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'freeform-ordered',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: {
                    left: convertInchesToTwip(0.5),
                    hanging: convertInchesToTwip(0.25),
                  },
                },
              },
            },
          ],
        },
        {
          reference: 'freeform-bullet',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: {
                    left: convertInchesToTwip(0.5),
                    hanging: convertInchesToTwip(0.25),
                  },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: {
              top: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
              right: PAGE_MARGIN,
            },
          },
        },
        children: children.flat(),
      },
    ],
  });
}

function legacyH(level: number, text: string, opts?: LegacyHeadingOpts): Paragraph {
  const clampedLevel = Math.max(1, Math.min(6, level));
  const runOpts: Record<string, unknown> = { text };
  if (opts?.color) runOpts.color = opts.color;
  return new Paragraph({
    heading: HEADING_LEVELS[clampedLevel],
    alignment: opts?.align,
    children: [new TextRun(runOpts as ConstructorParameters<typeof TextRun>[0])],
  });
}

function legacyP(text: string | TextRun[], opts?: LegacyParagraphOpts): Paragraph {
  const children =
    typeof text === 'string'
      ? [new TextRun({ text, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT })]
      : (text as TextRun[]);
  return new Paragraph({
    alignment: opts?.align,
    spacing: opts?.spacing,
    indent: opts?.indent,
    children,
  });
}

function legacyBold(text: string): TextRun {
  return new TextRun({ text, bold: true, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT });
}

function legacyItalic(text: string): TextRun {
  return new TextRun({ text, italics: true, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT });
}

function legacyList(items: string[], opts?: { ordered?: boolean }): Paragraph[] {
  const reference = opts?.ordered ? 'freeform-ordered' : 'freeform-bullet';
  return items.map(
    (item) =>
      new Paragraph({
        numbering: { reference, level: 0 },
        children: [new TextRun({ text: item, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT })],
      }),
  );
}

function legacyTable(
  headers: string[],
  rows: string[][],
  opts?: { widths?: number[] },
): Table {
  const columnCount = headers.length;
  const colWidths =
    opts?.widths && opts.widths.length === columnCount
      ? opts.widths
      : Array(columnCount).fill(Math.floor(CONTENT_WIDTH / columnCount));
  const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (header, i) =>
        new TableCell({
          width: { size: colWidths[i], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: 'e2e8f0', color: 'e2e8f0' },
          margins: cellMargins,
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: header,
                  bold: true,
                  size: DEFAULT_FONT_SIZE,
                  font: DEFAULT_FONT,
                }),
              ],
            }),
          ],
        }),
    ),
  });

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row
          .slice(0, columnCount)
          .concat(Array(Math.max(0, columnCount - row.length)).fill(''))
          .map(
            (cell, i) =>
              new TableCell({
                width: { size: colWidths[i], type: WidthType.DXA },
                margins: cellMargins,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: String(cell),
                        size: DEFAULT_FONT_SIZE,
                        font: DEFAULT_FONT,
                      }),
                    ],
                  }),
                ],
              }),
          ),
      }),
  );

  return new Table({
    width: {
      size: colWidths.reduce((a: number, b: number) => a + b, 0),
      type: WidthType.DXA,
    },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
    },
  });
}

function legacyPageBreak(): Paragraph {
  return new Paragraph({ children: [new DocxPageBreak()] });
}

function legacyHr(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 3, color: '94a3b8', space: 1 },
    },
    spacing: { before: 200, after: 200 },
    children: [],
  });
}

/**
 * Execute `script` under `node:vm` with legacy helper globals. Mirrors the
 * pattern of `api/src/services/docx-generation.ts:generateFreeformDocx`
 * (wrapped IIFE + `runInContext`). Returns the resulting Document instance.
 */
function runLegacyScript(script: string): Document {
  const sandbox: Record<string, unknown> = {
    doc: legacyDoc,
    h: legacyH,
    p: legacyP,
    bold: legacyBold,
    italic: legacyItalic,
    list: legacyList,
    table: legacyTable,
    pageBreak: legacyPageBreak,
    hr: legacyHr,
  };
  const context = vm.createContext(sandbox);
  const wrapped = `(function() { ${script} })()`;
  const compiled = new vm.Script(wrapped, { filename: 'legacy-freeform-docx.js' });
  const result = compiled.runInContext(context, { timeout: 5_000 });
  if (!(result instanceof Document)) {
    throw new Error('legacy script did not return a Document instance');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let runtimes: Array<SandboxRuntime> = [];

const makeRuntime = (): SandboxRuntime => {
  const rt = createIsolatedVmRuntime();
  runtimes.push(rt);
  return rt;
};

const makeInvocation = (
  input: Record<string, unknown>,
  caller?: unknown,
) => ({
  toolName: 'document_generate',
  input,
  caller,
});

afterEach(async () => {
  for (const rt of runtimes) {
    try {
      await rt.dispose();
    } catch {
      // ignore
    }
  }
  runtimes = [];
});

const stubFilesAdapter = () => {
  const captured: Array<{ name: string; mimeType: string; content: Uint8Array | string }> = [];
  return {
    captured,
    create: async (input: { name: string; mimeType: string; content: Uint8Array | string }) => {
      captured.push(input);
      return { artefactId: `art-${captured.length}`, mimeType: input.mimeType };
    },
  };
};

/**
 * Minimal ZIP archive parser: walks local file headers and returns a
 * `Map<entryName, Buffer>` of decompressed payloads. We do NOT use jszip
 * because the @sentropic/skills Makefile target only installs the `docx`,
 * `gray-matter`, `isolated-vm`, `zod`, and vitest deps — adding `jszip`
 * solely for the test would expand BR19-EX5. Instead we use `node:zlib` +
 * a small hand-rolled parser.
 *
 * Supported compression methods: `0` (stored / no compression) and `8`
 * (deflate). `docx`'s JSZip output uses only these two.
 */
function unzipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50; // "PK\x03\x04"
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
      // We hit the central directory or end of file — stop.
      break;
    }
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileName = buffer
      .subarray(offset + 30, offset + 30 + fileNameLength)
      .toString('utf8');
    const dataStart = offset + 30 + fileNameLength + extraFieldLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
    let payload: Buffer;
    if (compressionMethod === 0) {
      payload = Buffer.from(compressedData);
    } else if (compressionMethod === 8) {
      payload = inflateRawSync(compressedData);
    } else {
      throw new Error(
        `unzipEntries: unsupported compression method ${compressionMethod} for entry "${fileName}"`,
      );
    }
    if (payload.length !== uncompressedSize) {
      throw new Error(
        `unzipEntries: size mismatch for entry "${fileName}" (header=${uncompressedSize}, decompressed=${payload.length})`,
      );
    }
    entries.set(fileName, payload);
    offset = dataStart + compressedSize;
  }
  return entries;
}

/**
 * Assert that two DOCX buffers are structurally equal — i.e. every ZIP entry
 * decompresses to the same bytes, except `docProps/core.xml` which carries
 * `<dcterms:created>` / `<dcterms:modified>` timestamps the `docx` library
 * fills with the current wall clock (non-deterministic across runs).
 */
function expectDocxStructurallyEqual(
  golden: Buffer,
  candidate: Buffer,
  excludedEntries: ReadonlyArray<string> = ['docProps/core.xml'],
): void {
  const a = unzipEntries(golden);
  const b = unzipEntries(candidate);
  const aNames = [...a.keys()].filter((name) => !excludedEntries.includes(name)).sort();
  const bNames = [...b.keys()].filter((name) => !excludedEntries.includes(name)).sort();
  expect(bNames).toEqual(aNames);
  for (const name of aNames) {
    const aBuf = a.get(name);
    const bBuf = b.get(name);
    if (!aBuf || !bBuf) {
      throw new Error(`structurally-equal: missing entry "${name}"`);
    }
    if (!aBuf.equals(bBuf)) {
      throw new Error(
        `structurally-equal: entry "${name}" differs\n  golden length=${aBuf.length}\n  candidate length=${bBuf.length}\n  golden head=${aBuf.subarray(0, 80).toString('utf8')}\n  candidate head=${bBuf.subarray(0, 80).toString('utf8')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const MIN_FIXTURE_SCRIPT = `return doc([h(1, 'Title'), p('Body paragraph.')]);`;

describe('document_generate handler — deferred sub-paths', () => {
  const handler = createDocumentGenerateHandler(documentGenerateSkill);

  it('rejects action=upskill as removed (any format) per BR19-D6', async () => {
    await expect(
      handler(makeInvocation({ action: 'upskill', format: 'docx' })),
    ).rejects.toThrow(
      /document_generate sub-path 'action=upskill' is deferred/,
    );
    await expect(
      handler(makeInvocation({ action: 'upskill', format: 'pptx' })),
    ).rejects.toThrow(
      /document_generate sub-path 'action=upskill' is deferred/,
    );
  });

  it('throws deferred-error for action=generate&format=docx&templateId=...', async () => {
    await expect(
      handler(
        makeInvocation({
          action: 'generate',
          format: 'docx',
          templateId: 'usecase-onepage',
          entityType: 'initiative',
          entityId: 'i-1',
        }),
      ),
    ).rejects.toThrow(/templateId=usecase-onepage' is deferred/);
  });

  it('throws deferred-error when no code AND no templateId are provided (docx)', async () => {
    await expect(
      handler(makeInvocation({ action: 'generate', format: 'docx' })),
    ).rejects.toThrow(/no-code-no-templateId/);
  });

  it('throws deferred-error when no code AND no templateId are provided (pptx)', async () => {
    await expect(
      handler(makeInvocation({ action: 'generate', format: 'pptx' })),
    ).rejects.toThrow(/no-code-no-templateId/);
  });

  it('throws deferred-error for unknown action', async () => {
    await expect(handler(makeInvocation({ action: 'wat' }))).rejects.toThrow(
      /action=wat' is deferred/,
    );
  });
});

describe('document_generate handler — bound freeform-DOCX path', () => {
  it('routes the freeform-DOCX path through SandboxRuntime + bridge and surfaces files.create artefact', async () => {
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    const sandboxRuntime = makeRuntime();
    const filesAdapter = stubFilesAdapter();
    const caller = { sandboxRuntime, filesAdapter, title: 'Minimal fixture' };

    const result = await handler(
      makeInvocation(
        { action: 'generate', format: 'docx', code: MIN_FIXTURE_SCRIPT },
        caller,
      ),
    );
    expect(result.isError).toBeUndefined();
    const output = result.output as {
      artefactId: string;
      mimeType: string;
      fileName: string;
      byteLength: number;
    };
    expect(output.artefactId).toBe('art-1');
    expect(output.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(output.fileName).toBe('minimal-fixture.docx');
    expect(output.byteLength).toBeGreaterThan(0);
    expect(filesAdapter.captured).toHaveLength(1);
    expect(filesAdapter.captured[0].mimeType).toBe(output.mimeType);
  });

  it('returns isError + SANDBOX_THROW when the user script throws', async () => {
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    const sandboxRuntime = makeRuntime();
    const filesAdapter = stubFilesAdapter();
    const caller = { sandboxRuntime, filesAdapter };

    const result = await handler(
      makeInvocation(
        {
          action: 'generate',
          format: 'docx',
          code: `throw new Error('boom');`,
        },
        caller,
      ),
    );
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/sandbox failure/);
    expect(filesAdapter.captured).toHaveLength(0);
  });

  it('rejects when caller does not provide sandboxRuntime/filesAdapter', async () => {
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    await expect(
      handler(
        makeInvocation({
          action: 'generate',
          format: 'docx',
          code: MIN_FIXTURE_SCRIPT,
        }),
      ),
    ).rejects.toThrow(/caller must provide/);
  });
});

describe('document_generate handler — byte-stability vs legacy', () => {
  it('legacy DOCX bytes already differ across two runs (timestamp non-determinism)', async () => {
    // Sanity check: the `docx` library writes <dcterms:created>/<dcterms:modified>
    // into `docProps/core.xml` with the current wall clock, so two LEGACY runs
    // on the same script already produce different bytes. This documents the
    // limit of "strict byte equality" as a stability criterion. Stability is
    // therefore checked by extracting and comparing every ZIP entry EXCEPT
    // `docProps/core.xml` in the next test.
    const a = Buffer.from(await Packer.toBuffer(runLegacyScript(MIN_FIXTURE_SCRIPT)));
    // tiny wait to maximise the chance of different millisecond timestamps
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const b = Buffer.from(await Packer.toBuffer(runLegacyScript(MIN_FIXTURE_SCRIPT)));
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    // We don't strictly assert inequality (the timestamps COULD theoretically
    // match on a very fast machine), but the docProps/core.xml bytes carry
    // the divergence in practice. This test exists for documentation.
  });

  it('produces structurally-equal DOCX output for the minimum fixture script (every ZIP entry except docProps/core.xml is byte-equal)', async () => {
    // -----------------------------------------------------------------
    // Golden buffer: legacy `node:vm` + legacy helpers (mirrors
    // `api/src/services/docx-generation.ts:generateFreeformDocx`).
    // -----------------------------------------------------------------
    const goldenDocument = runLegacyScript(MIN_FIXTURE_SCRIPT);
    const goldenBuffer = Buffer.from(await Packer.toBuffer(goldenDocument));

    // -----------------------------------------------------------------
    // New buffer: V8 SandboxRuntime + docx-host-bridge.
    // -----------------------------------------------------------------
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    const sandboxRuntime = makeRuntime();
    const filesAdapter = stubFilesAdapter();
    const caller = { sandboxRuntime, filesAdapter, title: 'fixture' };
    const result = await handler(
      makeInvocation(
        { action: 'generate', format: 'docx', code: MIN_FIXTURE_SCRIPT },
        caller,
      ),
    );
    expect(result.isError).toBeUndefined();
    const newBuffer = filesAdapter.captured[0].content as Uint8Array;
    const newBufferBuf = Buffer.from(newBuffer);

    expectDocxStructurallyEqual(goldenBuffer, newBufferBuf);
  });
});

// ===========================================================================
// PPTX legacy helper reimplementation for byte-stability comparison.
//
// Line-for-line mirror of the helpers exposed by the legacy
// `api/src/services/pptx-freeform-helpers.ts`: `pptx`, `titleSlide`, plus
// the constructor resolver. Only the helpers used by the PPTX minimum
// fixture script are inlined here — adding helpers (sectionSlide, bullets,
// table, statCallout, footer, visualPlaceholder) would inflate this test file
// without strengthening the byte-stability proof.
// ===========================================================================

const PPTX_DEFAULT_FONT = 'Aptos';
const PPTX_DEFAULT_HEAD_FONT = 'Aptos Display';
const PPTX_DEFAULT_BG = 'FFFFFF';
const PPTX_DEFAULT_TEXT = '111827';
const PPTX_DEFAULT_MUTED = '475569';
const PPTX_DEFAULT_ACCENT = '2563EB';

interface PptxSlideLikeForTest {
  background?: { color?: string };
  addText(text: string, opts: Record<string, unknown>): unknown;
  addShape(shape: string, opts: Record<string, unknown>): unknown;
}

interface PptxPresentationLikeForTest {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  theme: { headFontFace?: string; bodyFontFace?: string };
  addSlide(): PptxSlideLikeForTest;
  write(opts: { outputType: 'nodebuffer' }): Promise<unknown>;
}

type PptxConstructorForTest = new () => PptxPresentationLikeForTest;

function isPptxConstructorForTest(value: unknown): value is PptxConstructorForTest {
  if (typeof value !== 'function') return false;
  const prototype = (value as { prototype?: Record<string, unknown> }).prototype;
  return (
    !!prototype &&
    typeof prototype === 'object' &&
    typeof prototype.addSlide === 'function' &&
    typeof prototype.write === 'function'
  );
}

function resolvePptxConstructorForTest(source: unknown): PptxConstructorForTest {
  const visited = new Set<unknown>();
  const queue: unknown[] = [source];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);
    if (isPptxConstructorForTest(candidate)) return candidate;
    if (typeof candidate === 'object' || typeof candidate === 'function') {
      const record = candidate as {
        default?: unknown;
        PptxGenJS?: unknown;
        pptxgenjs?: unknown;
      };
      queue.push(record.default, record.PptxGenJS, record.pptxgenjs);
    }
  }
  throw new Error('legacy pptx: cannot resolve constructor');
}

const PptxGenJSForTest: PptxConstructorForTest = resolvePptxConstructorForTest(
  pptxgenjsNamespace as unknown,
);

function pptxCleanHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

function pptxSafeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function legacyPptxTextOptions(
  opts: Record<string, unknown> = {},
): Record<string, unknown> {
  const fill = opts.fill
    ? {
        color: pptxCleanHex(opts.fill as string, PPTX_DEFAULT_BG),
        transparency: opts.transparency,
      }
    : undefined;
  return {
    x: opts.x ?? 0.7,
    y: opts.y ?? 0.7,
    w: opts.w ?? 11.9,
    h: opts.h ?? 0.6,
    fontFace: opts.fontFace ?? PPTX_DEFAULT_FONT,
    fontSize: opts.fontSize ?? 18,
    color: pptxCleanHex(opts.color as string | undefined, PPTX_DEFAULT_TEXT),
    bold: opts.bold,
    italic: opts.italic,
    align: opts.align ?? 'left',
    valign: opts.valign ?? 'top',
    margin: opts.margin ?? 0.08,
    fit: opts.fit ?? 'shrink',
    breakLine: opts.breakLine,
    ...(fill ? { fill } : {}),
  };
}

function legacyPptx(
  opts: {
    title?: string;
    subject?: string;
    author?: string;
    company?: string;
    layout?: string;
  } = {},
): PptxPresentationLikeForTest {
  const presentation = new PptxGenJSForTest();
  presentation.layout = opts.layout ?? 'LAYOUT_WIDE';
  presentation.author = pptxSafeText(opts.author, 'Sentropic');
  presentation.company = pptxSafeText(opts.company, 'Sentropic');
  presentation.subject = pptxSafeText(opts.subject, 'Generated presentation');
  presentation.title = pptxSafeText(opts.title, 'Generated presentation');
  presentation.theme = {
    headFontFace: PPTX_DEFAULT_HEAD_FONT,
    bodyFontFace: PPTX_DEFAULT_FONT,
  };
  return presentation;
}

function legacyPptxTitleSlide(
  presentation: PptxPresentationLikeForTest,
  title: unknown,
  subtitle?: unknown,
  opts: { background?: string; accent?: string; titleColor?: string } = {},
): PptxSlideLikeForTest {
  const slide = presentation.addSlide();
  slide.background = { color: pptxCleanHex(opts.background ?? PPTX_DEFAULT_BG, PPTX_DEFAULT_BG) };
  slide.addText(pptxSafeText(title, 'Untitled presentation'), {
    ...legacyPptxTextOptions({
      x: 0.75,
      y: 2.2,
      w: 11.8,
      h: 0.95,
      fontFace: PPTX_DEFAULT_HEAD_FONT,
      fontSize: 34,
      color: opts.titleColor ?? PPTX_DEFAULT_TEXT,
      bold: true,
      align: 'center',
      valign: 'middle',
    }),
  });
  if (subtitle !== undefined && pptxSafeText(subtitle)) {
    slide.addText(pptxSafeText(subtitle), {
      ...legacyPptxTextOptions({
        x: 1.65,
        y: 3.25,
        w: 10,
        h: 0.55,
        fontSize: 16,
        color: PPTX_DEFAULT_MUTED,
        align: 'center',
        valign: 'middle',
      }),
    });
  }
  slide.addShape('rect', {
    x: 5.55,
    y: 4.25,
    w: 2.2,
    h: 0.06,
    fill: { color: pptxCleanHex(opts.accent, PPTX_DEFAULT_ACCENT) },
    line: { color: pptxCleanHex(opts.accent, PPTX_DEFAULT_ACCENT), transparency: 100 },
  });
  return slide;
}

/**
 * Execute `script` under `node:vm` with the legacy PPTX helpers exposed as
 * globals. Mirrors `api/src/services/pptx-generation.ts:executeFreeformPptxCode`.
 */
function runLegacyPptxScript(script: string): PptxPresentationLikeForTest {
  const sandbox: Record<string, unknown> = {
    pptx: legacyPptx,
    titleSlide: legacyPptxTitleSlide,
  };
  const context = vm.createContext(sandbox);
  const wrapped = `(function() { ${script} })()`;
  const compiled = new vm.Script(wrapped, { filename: 'legacy-freeform-pptx.js' });
  const result = compiled.runInContext(context, { timeout: 5_000 });
  if (
    !result ||
    typeof result !== 'object' ||
    typeof (result as { write?: unknown }).write !== 'function'
  ) {
    throw new Error('legacy pptx script did not return a Presentation');
  }
  return result as PptxPresentationLikeForTest;
}

async function writeLegacyPptxToBuffer(
  presentation: PptxPresentationLikeForTest,
): Promise<Buffer> {
  const output = await presentation.write({ outputType: 'nodebuffer' });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (output instanceof ArrayBuffer) return Buffer.from(output);
  if (typeof output === 'string') return Buffer.from(output, 'binary');
  throw new Error('legacy pptx: unsupported write output type');
}

const MIN_PPTX_FIXTURE_SCRIPT = `
  const p = pptx({ title: 'Fixture' });
  titleSlide(p, 'Hello', 'World');
  return p;
`;

describe('document_generate handler — bound freeform-PPTX path', () => {
  it('routes the freeform-PPTX path through SandboxRuntime + bridge and surfaces files.create artefact', async () => {
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    const sandboxRuntime = makeRuntime();
    const filesAdapter = stubFilesAdapter();
    const caller = { sandboxRuntime, filesAdapter, title: 'Minimal pptx fixture' };

    const result = await handler(
      makeInvocation(
        { action: 'generate', format: 'pptx', code: MIN_PPTX_FIXTURE_SCRIPT },
        caller,
      ),
    );
    expect(result.isError).toBeUndefined();
    const output = result.output as {
      artefactId: string;
      mimeType: string;
      fileName: string;
      byteLength: number;
    };
    expect(output.artefactId).toBe('art-1');
    expect(output.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(output.fileName).toBe('minimal-pptx-fixture.pptx');
    expect(output.byteLength).toBeGreaterThan(0);
    expect(filesAdapter.captured).toHaveLength(1);
    expect(filesAdapter.captured[0].mimeType).toBe(output.mimeType);
    // PPTX is also a ZIP archive.
    const newBuffer = Buffer.from(filesAdapter.captured[0].content as Uint8Array);
    expect(newBuffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });

  it('returns isError + sandbox failure when the user pptx script throws', async () => {
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    const sandboxRuntime = makeRuntime();
    const filesAdapter = stubFilesAdapter();
    const caller = { sandboxRuntime, filesAdapter };

    const result = await handler(
      makeInvocation(
        {
          action: 'generate',
          format: 'pptx',
          code: `throw new Error('pptx-boom');`,
        },
        caller,
      ),
    );
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/sandbox failure/);
    expect(filesAdapter.captured).toHaveLength(0);
  });

  it('rejects when caller does not provide sandboxRuntime/filesAdapter for pptx', async () => {
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    await expect(
      handler(
        makeInvocation({
          action: 'generate',
          format: 'pptx',
          code: MIN_PPTX_FIXTURE_SCRIPT,
        }),
      ),
    ).rejects.toThrow(/caller must provide/);
  });
});

describe('document_generate handler — byte-stability vs legacy (PPTX)', () => {
  it('legacy PPTX bytes already differ across two runs (timestamp non-determinism)', async () => {
    // Sanity check: PptGenJS embeds wall-clock timestamps in its output
    // (via JSZip's per-entry DOS-time + `docProps/core.xml` / `docProps/app.xml`),
    // so two legacy runs on the same script may produce different bytes. This
    // documents the limit of strict byte equality. Stability is therefore
    // checked by extracting and comparing every ZIP entry EXCEPT the volatile
    // ones in the next test.
    const a = await writeLegacyPptxToBuffer(runLegacyPptxScript(MIN_PPTX_FIXTURE_SCRIPT));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const b = await writeLegacyPptxToBuffer(runLegacyPptxScript(MIN_PPTX_FIXTURE_SCRIPT));
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('produces structurally-equal PPTX output for the minimum fixture script (every ZIP entry except docProps/{core,app}.xml is byte-equal)', async () => {
    // -----------------------------------------------------------------
    // Golden buffer: legacy `node:vm` + legacy pptx helpers (mirrors
    // `api/src/services/pptx-generation.ts:executeFreeformPptxCode`).
    // -----------------------------------------------------------------
    const goldenPresentation = runLegacyPptxScript(MIN_PPTX_FIXTURE_SCRIPT);
    const goldenBuffer = await writeLegacyPptxToBuffer(goldenPresentation);

    // -----------------------------------------------------------------
    // New buffer: V8 SandboxRuntime + pptx-host-bridge.
    // -----------------------------------------------------------------
    const handler = createDocumentGenerateHandler(documentGenerateSkill);
    const sandboxRuntime = makeRuntime();
    const filesAdapter = stubFilesAdapter();
    const caller = { sandboxRuntime, filesAdapter, title: 'fixture' };
    const result = await handler(
      makeInvocation(
        { action: 'generate', format: 'pptx', code: MIN_PPTX_FIXTURE_SCRIPT },
        caller,
      ),
    );
    expect(result.isError).toBeUndefined();
    const newBuffer = Buffer.from(filesAdapter.captured[0].content as Uint8Array);

    // PPTX volatile entries: PptGenJS writes wall-clock timestamps into
    // `docProps/core.xml` (`<dcterms:created>`, `<dcterms:modified>`) and
    // sometimes `docProps/app.xml`. Both are excluded from byte-stability.
    expectDocxStructurallyEqual(goldenBuffer, newBuffer, [
      'docProps/core.xml',
      'docProps/app.xml',
    ]);
  });
});
