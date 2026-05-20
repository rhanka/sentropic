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

  it('throws deferred-error for action=upskill (any format)', async () => {
    await expect(
      handler(makeInvocation({ action: 'upskill', format: 'docx' })),
    ).rejects.toThrow(
      /document_generate sub-path 'action=upskill&format=docx' is deferred to Wave D step 1.B\/1.C/,
    );
    await expect(
      handler(makeInvocation({ action: 'upskill', format: 'pptx' })),
    ).rejects.toThrow(
      /document_generate sub-path 'action=upskill&format=pptx' is deferred/,
    );
  });

  it('throws deferred-error for action=generate&format=pptx', async () => {
    await expect(
      handler(makeInvocation({ action: 'generate', format: 'pptx', code: 'return pptx();' })),
    ).rejects.toThrow(/format=pptx' is deferred/);
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

  it('throws deferred-error when no code AND no templateId are provided', async () => {
    await expect(
      handler(makeInvocation({ action: 'generate', format: 'docx' })),
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
