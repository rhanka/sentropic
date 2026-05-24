/**
 * Host-side DOCX bridge for the V8 sandbox.
 *
 * The bridge replicates the legacy `getSandboxGlobals` helper API
 * (`doc`/`h`/`p`/`bold`/`italic`/`list`/`table`/`pageBreak`/`hr`) host-side,
 * where the real `docx` library is loaded. Isolate-side glue exposes the same
 * helper names through `ivm.Reference.applySync` so a user script written for
 * the legacy `node:vm`-based runtime works unchanged.
 *
 * Lifecycle per `SandboxRuntime.execute()` call:
 *   1. Host calls `createDocxHostBridge()` to obtain a fresh bridge with its
 *      own handle map (no cross-skill leakage).
 *   2. The runtime installs the bridge's `__hostDocx*` references into the
 *      isolate context as part of `injectApiSurface`.
 *   3. The bootstrap glue (see `runtime.ts`) wires each `__hostDocx*` reference
 *      into a friendly sync helper inside the isolate (legacy parity).
 *   4. The user script returns the final document handle id (or a docx
 *      `Document` instance — the host accepts both for byte-stability with
 *      legacy `generateFreeformDocx`).
 *   5. The host calls `packToBuffer(handle)` to produce the DOCX Buffer.
 *
 * The bridge does NOT leak `require`/`process`/`Buffer` into the isolate; only
 * `ivm.Reference`-wrapped sync function proxies are installed.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak as DocxPageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';

// ---------------------------------------------------------------------------
// Default style constants (mirror api/src/services/docx-freeform-helpers.ts)
// ---------------------------------------------------------------------------

const DEFAULT_FONT = 'Arial';
const DEFAULT_FONT_SIZE = 24; // half-points → 12pt

const PAGE_WIDTH = 12240; // 8.5 inches in DXA
const PAGE_HEIGHT = 15840; // 11 inches in DXA
const PAGE_MARGIN = 1440; // 1 inch in DXA
const CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN; // 9360 DXA

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

// ---------------------------------------------------------------------------
// Handle types
// ---------------------------------------------------------------------------

const HANDLE_PREFIX = {
  document: 'docx:doc:',
  paragraph: 'docx:par:',
  table: 'docx:tab:',
  textRun: 'docx:run:',
} as const;

type DocxBridgeNode = Paragraph | Table | TextRun | Document;

type DocxHandleKind = keyof typeof HANDLE_PREFIX;

/**
 * Public bridge handle: opaque string identifier passed across the isolate
 * boundary. Consumers MUST treat the format as private; only the bridge can
 * resolve it.
 */
export type DocxBridgeHandle = string;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Host-side bridge for DOCX construction inside the V8 sandbox.
 *
 * Each `hostFn*` field is a synchronous host function safe to wrap with
 * `ivm.Reference` and invoke from the isolate via `applySync`. They accept
 * plain-JSON arguments (and arrays of handles for nesting) and return string
 * handle ids.
 */
export interface DocxHostBridge {
  /** Resolve a handle to a `Document` and pack it to a DOCX buffer. */
  packToBuffer(handle: DocxBridgeHandle | Document): Promise<Buffer>;
  /** Number of live handles (observability/tests). */
  size(): number;
  /** Drop every retained node (called once per `execute()` for hygiene). */
  reset(): void;
  /** Internal: function map exposed to the isolate. Keys mirror legacy helper names. */
  readonly hostFns: Readonly<Record<string, (...args: unknown[]) => DocxBridgeHandle>>;
}

/**
 * Construct a fresh `DocxHostBridge` with isolated state. Each
 * `SandboxRuntime.execute()` call must allocate a new bridge to avoid handle
 * leakage between skills.
 */
export function createDocxHostBridge(): DocxHostBridge {
  const nodes = new Map<string, DocxBridgeNode>();
  let counter = 0;

  const mint = (kind: DocxHandleKind, node: DocxBridgeNode): string => {
    counter += 1;
    const handle = `${HANDLE_PREFIX[kind]}${counter}`;
    nodes.set(handle, node);
    return handle;
  };

  const resolveParagraphOrTable = (handle: unknown): Paragraph | Table => {
    if (typeof handle !== 'string') {
      throw new TypeError(`docx bridge: expected string handle, got ${typeof handle}`);
    }
    const node = nodes.get(handle);
    if (!node) {
      throw new Error(`docx bridge: unknown handle "${handle}"`);
    }
    if (node instanceof Paragraph || node instanceof Table) return node;
    throw new TypeError(`docx bridge: handle "${handle}" is not a Paragraph or Table`);
  };

  const resolveTextRun = (handle: unknown): TextRun => {
    if (typeof handle !== 'string') {
      throw new TypeError(`docx bridge: expected string handle, got ${typeof handle}`);
    }
    const node = nodes.get(handle);
    if (!(node instanceof TextRun)) {
      throw new TypeError(`docx bridge: handle "${handle}" is not a TextRun`);
    }
    return node;
  };

  // -------------------------------------------------------------------------
  // doc(children, opts?) — full Document with sensible defaults
  // -------------------------------------------------------------------------
  const docFn = (childrenRaw: unknown, optsRaw?: unknown): string => {
    const childHandles = Array.isArray(childrenRaw) ? childrenRaw : [];
    const children = childHandles.map(resolveParagraphOrTable);
    const opts = (optsRaw ?? {}) as { styles?: Record<string, unknown> };

    const document = new Document({
      styles: (opts.styles as Document['styles']) ?? {
        default: {
          document: {
            run: { font: DEFAULT_FONT, size: DEFAULT_FONT_SIZE },
          },
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
          children,
        },
      ],
    });

    return mint('document', document);
  };

  // -------------------------------------------------------------------------
  // h(level, text, opts?) — heading paragraph
  // -------------------------------------------------------------------------
  const headingFn = (levelRaw: unknown, textRaw: unknown, optsRaw?: unknown): string => {
    const level = typeof levelRaw === 'number' ? levelRaw : 1;
    const text = typeof textRaw === 'string' ? textRaw : '';
    const opts = (optsRaw ?? {}) as {
      color?: string;
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    };
    const clampedLevel = Math.max(1, Math.min(6, level));
    const runOpts: Record<string, unknown> = { text };
    if (opts.color) runOpts.color = opts.color;
    const paragraph = new Paragraph({
      heading: HEADING_LEVELS[clampedLevel],
      alignment: opts.align,
      children: [new TextRun(runOpts as ConstructorParameters<typeof TextRun>[0])],
    });
    return mint('paragraph', paragraph);
  };

  // -------------------------------------------------------------------------
  // p(textOrRuns, opts?) — body paragraph
  // -------------------------------------------------------------------------
  const paragraphFn = (textRaw: unknown, optsRaw?: unknown): string => {
    const opts = (optsRaw ?? {}) as {
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
      spacing?: { before?: number; after?: number };
      indent?: { left?: number; firstLine?: number };
    };
    let children: TextRun[];
    if (typeof textRaw === 'string') {
      children = [new TextRun({ text: textRaw, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT })];
    } else if (Array.isArray(textRaw)) {
      children = textRaw.map((entry) => resolveTextRun(entry));
    } else {
      children = [new TextRun({ text: '', size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT })];
    }
    const paragraph = new Paragraph({
      alignment: opts.align,
      spacing: opts.spacing,
      indent: opts.indent,
      children,
    });
    return mint('paragraph', paragraph);
  };

  // -------------------------------------------------------------------------
  // bold(text) / italic(text) — styled TextRun
  // -------------------------------------------------------------------------
  const boldFn = (textRaw: unknown): string => {
    const text = typeof textRaw === 'string' ? textRaw : '';
    return mint(
      'textRun',
      new TextRun({ text, bold: true, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT }),
    );
  };

  const italicFn = (textRaw: unknown): string => {
    const text = typeof textRaw === 'string' ? textRaw : '';
    return mint(
      'textRun',
      new TextRun({ text, italics: true, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT }),
    );
  };

  // -------------------------------------------------------------------------
  // list(items, opts?) — bullet or numbered list (returns ARRAY handle by
  // minting one paragraph handle per item — caller arrays them itself).
  // To keep parity with the legacy helper which returns `Paragraph[]`, we
  // return an array of handle strings so the caller can `...spread` them
  // inside `doc([...list(items)])`.
  // -------------------------------------------------------------------------
  const listFn = (itemsRaw: unknown, optsRaw?: unknown): string[] => {
    const opts = (optsRaw ?? {}) as { ordered?: boolean };
    const reference = opts.ordered ? 'freeform-ordered' : 'freeform-bullet';
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    return items.map((item) => {
      const text = typeof item === 'string' ? item : String(item);
      const paragraph = new Paragraph({
        numbering: { reference, level: 0 },
        children: [
          new TextRun({ text, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT }),
        ],
      });
      return mint('paragraph', paragraph);
    });
  };

  // -------------------------------------------------------------------------
  // table(headers, rows, opts?) — styled table
  // -------------------------------------------------------------------------
  const tableFn = (headersRaw: unknown, rowsRaw: unknown, optsRaw?: unknown): string => {
    const headers = Array.isArray(headersRaw)
      ? headersRaw.map((h) => (typeof h === 'string' ? h : String(h)))
      : [];
    const rows = Array.isArray(rowsRaw)
      ? rowsRaw.map((row) =>
          Array.isArray(row) ? row.map((c) => (typeof c === 'string' ? c : String(c))) : [],
        )
      : [];
    const opts = (optsRaw ?? {}) as { widths?: number[] };

    const columnCount = headers.length;
    const colWidths =
      opts.widths && opts.widths.length === columnCount
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

    const table = new Table({
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

    return mint('table', table);
  };

  // -------------------------------------------------------------------------
  // pageBreak() / hr() — utility paragraphs
  // -------------------------------------------------------------------------
  const pageBreakFn = (): string =>
    mint('paragraph', new Paragraph({ children: [new DocxPageBreak()] }));

  const hrFn = (): string =>
    mint(
      'paragraph',
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 3, color: '94a3b8', space: 1 },
        },
        spacing: { before: 200, after: 200 },
        children: [],
      }),
    );

  const hostFns = Object.freeze({
    __hostDocxDoc: docFn as (...args: unknown[]) => string,
    __hostDocxHeading: headingFn as (...args: unknown[]) => string,
    __hostDocxParagraph: paragraphFn as (...args: unknown[]) => string,
    __hostDocxBold: boldFn as (...args: unknown[]) => string,
    __hostDocxItalic: italicFn as (...args: unknown[]) => string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __hostDocxList: listFn as unknown as (...args: unknown[]) => any,
    __hostDocxTable: tableFn as (...args: unknown[]) => string,
    __hostDocxPageBreak: pageBreakFn as (...args: unknown[]) => string,
    __hostDocxHr: hrFn as (...args: unknown[]) => string,
  });

  return {
    hostFns,
    size: () => nodes.size,
    reset: () => nodes.clear(),
    async packToBuffer(handle: DocxBridgeHandle | Document): Promise<Buffer> {
      let document: Document | undefined;
      if (handle instanceof Document) {
        document = handle;
      } else if (typeof handle === 'string') {
        const node = nodes.get(handle);
        if (!(node instanceof Document)) {
          throw new Error(
            `docx bridge: packToBuffer expected a Document handle, got "${handle}"`,
          );
        }
        document = node;
      } else {
        throw new TypeError(
          `docx bridge: packToBuffer expected handle string or Document, got ${typeof handle}`,
        );
      }
      return Buffer.from(await Packer.toBuffer(document));
    },
  };
}

/**
 * Bootstrap glue source injected into the isolate context to wire the
 * `__hostDocx*` references into legacy-shaped sync helpers (`doc`, `h`, `p`,
 * `bold`, `italic`, `list`, `table`, `pageBreak`, `hr`). The script keeps the
 * legacy helper signatures intact so a fixture authored against
 * `getSandboxGlobals` runs unchanged.
 */
export const DOCX_BRIDGE_BOOTSTRAP = `
const __callDocxSync = (ref) => (...args) =>
  ref.applySync(undefined, args, { arguments: { copy: true }, result: { copy: true } });
const doc = __callDocxSync(__hostDocxDoc);
const document = doc;
const h = __callDocxSync(__hostDocxHeading);
const p = __callDocxSync(__hostDocxParagraph);
const bold = __callDocxSync(__hostDocxBold);
const italic = __callDocxSync(__hostDocxItalic);
const list = __callDocxSync(__hostDocxList);
const table = __callDocxSync(__hostDocxTable);
const pageBreak = __callDocxSync(__hostDocxPageBreak);
const hr = __callDocxSync(__hostDocxHr);
`;
