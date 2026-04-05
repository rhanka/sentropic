/**
 * Freeform DOCX generation helpers.
 *
 * Provides a concise API for LLM-generated code to build DOCX documents
 * using the `docx` library. All helpers return native docx objects.
 */

import * as docxLib from 'docx';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocOpts = {
  styles?: Record<string, unknown>;
  header?: string;
  footer?: string;
};

type HeadingOpts = {
  color?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
};

type ParagraphOpts = {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  spacing?: { before?: number; after?: number };
  indent?: { left?: number; firstLine?: number };
};

type ListOpts = {
  ordered?: boolean;
};

type TableOpts = {
  widths?: number[];
};

export type FreeformContext = {
  entity: Record<string, unknown>;
  initiatives: Record<string, unknown>[];
  matrix: Record<string, unknown> | null;
  workspace: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Default style constants
// ---------------------------------------------------------------------------

const DEFAULT_FONT = 'Calibri';
const DEFAULT_FONT_SIZE = 22; // half-points → 11pt
const HEADING_COLOR = '1e293b'; // slate-800

const HEADING_SIZES: Record<number, number> = {
  1: 48, // 24pt
  2: 40, // 20pt
  3: 34, // 17pt
  4: 28, // 14pt
  5: 24, // 12pt
  6: 22, // 11pt
};

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Create a full Document with sensible defaults (Calibri 11pt, 1.15 spacing, standard margins).
 */
export function doc(children: (Paragraph | Table)[], opts?: DocOpts): Document {
  return new Document({
    styles: (opts?.styles as Document['styles']) ?? {
      default: {
        document: {
          run: {
            font: DEFAULT_FONT,
            size: DEFAULT_FONT_SIZE,
          },
          paragraph: {
            spacing: { line: 276 }, // 1.15 line spacing (240 * 1.15)
          },
        },
      },
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
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
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
              text: '\u2022',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
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
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: children.flat(),
      },
    ],
  });
}

/**
 * Create a heading paragraph (H1-H6 with scaled sizes).
 */
export function h(
  level: number,
  text: string,
  opts?: HeadingOpts
): Paragraph {
  const clampedLevel = Math.max(1, Math.min(6, level));
  return new Paragraph({
    heading: HEADING_LEVELS[clampedLevel],
    alignment: opts?.align,
    children: [
      new TextRun({
        text,
        bold: true,
        size: HEADING_SIZES[clampedLevel],
        font: DEFAULT_FONT,
        color: opts?.color ?? HEADING_COLOR,
      }),
    ],
  });
}

/**
 * Create a body paragraph.
 */
export function p(
  text: string | (typeof TextRun.prototype)[],
  opts?: ParagraphOpts
): Paragraph {
  const children = typeof text === 'string'
    ? [new TextRun({ text, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT })]
    : (text as TextRun[]);

  return new Paragraph({
    alignment: opts?.align,
    spacing: opts?.spacing,
    indent: opts?.indent,
    children,
  });
}

/**
 * Create a bold TextRun.
 */
export function bold(text: string): TextRun {
  return new TextRun({ text, bold: true, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT });
}

/**
 * Create an italic TextRun.
 */
export function italic(text: string): TextRun {
  return new TextRun({ text, italics: true, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT });
}

/**
 * Create a list of paragraphs (bullet or numbered).
 */
export function list(items: string[], opts?: ListOpts): Paragraph[] {
  const reference = opts?.ordered ? 'freeform-ordered' : 'freeform-bullet';
  return items.map(
    (item) =>
      new Paragraph({
        numbering: { reference, level: 0 },
        children: [
          new TextRun({ text: item, size: DEFAULT_FONT_SIZE, font: DEFAULT_FONT }),
        ],
      })
  );
}

/**
 * Create a table with header row styling.
 */
export function table(
  headers: string[],
  rows: string[][],
  opts?: TableOpts
): Table {
  const columnCount = headers.length;

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (header) =>
        new TableCell({
          shading: { type: ShadingType.SOLID, fill: 'e2e8f0', color: 'e2e8f0' },
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
        })
    ),
  });

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row
          .slice(0, columnCount)
          .concat(Array(Math.max(0, columnCount - row.length)).fill(''))
          .map(
            (cell) =>
              new TableCell({
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
              })
          ),
      })
  );

  const tableOpts: ConstructorParameters<typeof Table>[0] = {
    rows: [headerRow, ...dataRows],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
    },
  };

  if (opts?.widths && opts.widths.length === columnCount) {
    tableOpts.columnWidths = opts.widths;
    tableOpts.width = { size: opts.widths.reduce((a, b) => a + b, 0), type: WidthType.DXA };
  }

  return new Table(tableOpts);
}

/**
 * Create a paragraph with a page break.
 */
export function pageBreak(): Paragraph {
  return new Paragraph({
    children: [new DocxPageBreak()],
  });
}

/**
 * Create a horizontal rule (styled as a bottom-bordered paragraph).
 */
export function hr(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 3, color: '94a3b8', space: 1 },
    },
    spacing: { before: 200, after: 200 },
    children: [],
  });
}

// ---------------------------------------------------------------------------
// Sandbox globals builder
// ---------------------------------------------------------------------------

/**
 * Build the full set of globals to inject into the vm sandbox context.
 * Includes all docx library exports, helper functions, and context data.
 */
export function getSandboxGlobals(context: FreeformContext): Record<string, unknown> {
  return {
    // Helper functions (recommended API)
    doc,
    h,
    p,
    bold,
    italic,
    list,
    table,
    pageBreak,
    hr,

    // Raw docx classes (advanced usage)
    ...docxLib,

    // Context data
    context,

    // Safe built-ins
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Error,
    console: {
      log: (...args: unknown[]) => {
        // Captured but not forwarded to stdout for security
        void args;
      },
      warn: (...args: unknown[]) => { void args; },
      error: (...args: unknown[]) => { void args; },
    },
  };
}
