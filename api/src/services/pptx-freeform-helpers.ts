/**
 * Freeform PPTX generation helpers.
 *
 * Provides a compact API for LLM-generated code to build PowerPoint files
 * with PptGenJS inside the Sentropic sandbox.
 */

import pptxgenjs from 'pptxgenjs';

export type PptxPresentation = InstanceType<typeof pptxgenjs>;
export type PptxSlide = ReturnType<PptxPresentation['addSlide']>;
type PptxConstructor = new () => PptxPresentation;

type AddTextOptions = NonNullable<Parameters<PptxSlide['addText']>[1]>;
type ShapeName = Parameters<PptxSlide['addShape']>[0];
type ShapeOptions = NonNullable<Parameters<PptxSlide['addShape']>[1]>;
type TableRows = Parameters<PptxSlide['addTable']>[0];
type TableOptions = NonNullable<Parameters<PptxSlide['addTable']>[1]>;

export type PptxFreeformContext = {
  entity: Record<string, unknown>;
  initiatives: Record<string, unknown>[];
  matrix: Record<string, unknown> | null;
  workspace: Record<string, unknown>;
};

type PresentationOpts = {
  title?: string;
  subject?: string;
  author?: string;
  company?: string;
  layout?: 'LAYOUT_WIDE' | 'LAYOUT_16x9' | 'LAYOUT_16x10' | 'LAYOUT_4x3';
};

type SlideTextOpts = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fontFace?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: AddTextOptions['align'];
  valign?: AddTextOptions['valign'];
  margin?: number;
  fit?: AddTextOptions['fit'];
  fill?: string;
  transparency?: number;
  breakLine?: boolean;
};

type SlideShellOpts = {
  background?: string;
  accent?: string;
  titleColor?: string;
};

type TableOpts = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  headerFill?: string;
  borderColor?: string;
  color?: string;
  margin?: number;
};

const DEFAULT_FONT = 'Aptos';
const DEFAULT_HEAD_FONT = 'Aptos Display';
const DEFAULT_BG = 'FFFFFF';
const DEFAULT_TEXT = '111827';
const DEFAULT_MUTED = '475569';
const DEFAULT_ACCENT = '2563EB';
const RECT: ShapeName = 'rect';

function isPptxConstructor(value: unknown): value is PptxConstructor {
  if (typeof value !== 'function') return false;
  const prototype = (value as { prototype?: Record<string, unknown> }).prototype;
  return (
    !!prototype &&
    typeof prototype === 'object' &&
    typeof prototype.addSlide === 'function' &&
    typeof prototype.write === 'function'
  );
}

export function resolvePptxGenJSConstructor(source: unknown): PptxConstructor {
  const visited = new Set<unknown>();
  const queue: unknown[] = [source];

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);

    if (isPptxConstructor(candidate)) {
      return candidate;
    }

    if (typeof candidate === 'object' || typeof candidate === 'function') {
      const record = candidate as {
        default?: unknown;
        PptxGenJS?: unknown;
        pptxgenjs?: unknown;
      };
      queue.push(record.default, record.PptxGenJS, record.pptxgenjs);
    }
  }

  throw new Error('pptxgenjs_export_error: Could not resolve a constructible PptGenJS export');
}

export const PptxGenJS = resolvePptxGenJSConstructor(pptxgenjs);

export const WIDE_SLIDE = {
  width: 13.333,
  height: 7.5,
};

function cleanHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

export function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function addBackground(slide: PptxSlide, color: string): void {
  slide.background = { color: cleanHex(color, DEFAULT_BG) };
}

function textOptions(opts: SlideTextOpts = {}): AddTextOptions {
  const fill = opts.fill
    ? { color: cleanHex(opts.fill, DEFAULT_BG), transparency: opts.transparency }
    : undefined;

  return {
    x: opts.x ?? 0.7,
    y: opts.y ?? 0.7,
    w: opts.w ?? 11.9,
    h: opts.h ?? 0.6,
    fontFace: opts.fontFace ?? DEFAULT_FONT,
    fontSize: opts.fontSize ?? 18,
    color: cleanHex(opts.color, DEFAULT_TEXT),
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

export function pptx(opts: PresentationOpts = {}): PptxPresentation {
  const presentation = new PptxGenJS();
  presentation.layout = opts.layout ?? 'LAYOUT_WIDE';
  presentation.author = safeText(opts.author, 'Sentropic');
  presentation.company = safeText(opts.company, 'Sentropic');
  presentation.subject = safeText(opts.subject, 'Generated presentation');
  presentation.title = safeText(opts.title, 'Generated presentation');
  presentation.theme = {
    headFontFace: DEFAULT_HEAD_FONT,
    bodyFontFace: DEFAULT_FONT,
  };
  return presentation;
}

export function titleSlide(
  presentation: PptxPresentation,
  title: unknown,
  subtitle?: unknown,
  opts: SlideShellOpts = {},
): PptxSlide {
  const slide = presentation.addSlide();
  addBackground(slide, opts.background ?? DEFAULT_BG);
  slide.addText(safeText(title, 'Untitled presentation'), {
    ...textOptions({
      x: 0.75,
      y: 2.2,
      w: 11.8,
      h: 0.95,
      fontFace: DEFAULT_HEAD_FONT,
      fontSize: 34,
      color: opts.titleColor ?? DEFAULT_TEXT,
      bold: true,
      align: 'center',
      valign: 'middle',
    }),
  });
  if (subtitle !== undefined && safeText(subtitle)) {
    slide.addText(safeText(subtitle), {
      ...textOptions({
        x: 1.65,
        y: 3.25,
        w: 10,
        h: 0.55,
        fontSize: 16,
        color: DEFAULT_MUTED,
        align: 'center',
        valign: 'middle',
      }),
    });
  }
  slide.addShape(RECT, {
    x: 5.55,
    y: 4.25,
    w: 2.2,
    h: 0.06,
    fill: { color: cleanHex(opts.accent, DEFAULT_ACCENT) },
    line: { color: cleanHex(opts.accent, DEFAULT_ACCENT), transparency: 100 },
  } satisfies ShapeOptions);
  return slide;
}

export function sectionSlide(
  presentation: PptxPresentation,
  title: unknown,
  subtitle?: unknown,
  opts: SlideShellOpts = {},
): PptxSlide {
  const slide = presentation.addSlide();
  addBackground(slide, opts.background ?? 'F8FAFC');
  slide.addShape(RECT, {
    x: 0,
    y: 0,
    w: 0.22,
    h: WIDE_SLIDE.height,
    fill: { color: cleanHex(opts.accent, DEFAULT_ACCENT) },
    line: { color: cleanHex(opts.accent, DEFAULT_ACCENT), transparency: 100 },
  } satisfies ShapeOptions);
  slide.addText(safeText(title, 'Section'), {
    ...textOptions({
      x: 0.8,
      y: 2.45,
      w: 10.8,
      h: 0.8,
      fontFace: DEFAULT_HEAD_FONT,
      fontSize: 28,
      color: opts.titleColor ?? DEFAULT_TEXT,
      bold: true,
      valign: 'middle',
    }),
  });
  if (subtitle !== undefined && safeText(subtitle)) {
    slide.addText(safeText(subtitle), {
      ...textOptions({
        x: 0.82,
        y: 3.28,
        w: 10.5,
        h: 0.55,
        fontSize: 15,
        color: DEFAULT_MUTED,
      }),
    });
  }
  return slide;
}

export function textBox(slide: PptxSlide, text: unknown, opts: SlideTextOpts = {}): PptxSlide {
  slide.addText(safeText(text), textOptions(opts));
  return slide;
}

export function bullets(
  slide: PptxSlide,
  items: unknown[],
  opts: SlideTextOpts & { indent?: number } = {},
): PptxSlide {
  const text = items.map((item) => safeText(item)).filter(Boolean).join('\n');
  slide.addText(text || ' ', {
    ...textOptions({ x: 0.85, y: 1.65, w: 11.4, h: 4.7, fontSize: 18, ...opts }),
    bullet: { type: 'bullet', indent: opts.indent ?? 18 },
    breakLine: false,
  });
  return slide;
}

export function table(
  slide: PptxSlide,
  headers: unknown[],
  rows: unknown[][],
  opts: TableOpts = {},
): PptxSlide {
  const headerCells = headers.map((header) => ({
    text: safeText(header),
    options: {
      bold: true,
      color: DEFAULT_TEXT,
      fill: { color: cleanHex(opts.headerFill, 'DBEAFE') },
      margin: opts.margin ?? 0.08,
    },
  }));
  const bodyRows = rows.map((row) =>
    row.map((cell) => ({
      text: safeText(cell),
      options: { color: cleanHex(opts.color, DEFAULT_TEXT), margin: opts.margin ?? 0.08 },
    })),
  );

  slide.addTable([headerCells, ...bodyRows] as TableRows, {
    x: opts.x ?? 0.7,
    y: opts.y ?? 1.25,
    w: opts.w ?? 11.9,
    h: opts.h,
    fontFace: DEFAULT_FONT,
    fontSize: opts.fontSize ?? 11,
    border: { type: 'solid', color: cleanHex(opts.borderColor, 'CBD5E1'), pt: 0.7 },
    valign: 'middle',
  } satisfies TableOptions);
  return slide;
}

export function statCallout(
  slide: PptxSlide,
  label: unknown,
  value: unknown,
  opts: SlideTextOpts & { accent?: string } = {},
): PptxSlide {
  const x = opts.x ?? 0.75;
  const y = opts.y ?? 1.25;
  const w = opts.w ?? 3.5;
  const h = opts.h ?? 1.35;
  const accent = cleanHex(opts.accent, DEFAULT_ACCENT);
  slide.addShape(RECT, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: cleanHex(opts.fill, 'EFF6FF') },
    line: { color: accent, transparency: 35 },
  } satisfies ShapeOptions);
  slide.addText(safeText(value, '0'), {
    ...textOptions({
      x: x + 0.18,
      y: y + 0.18,
      w: w - 0.36,
      h: 0.48,
      fontSize: opts.fontSize ?? 23,
      bold: true,
      color: accent,
      margin: 0,
    }),
  });
  slide.addText(safeText(label), {
    ...textOptions({
      x: x + 0.18,
      y: y + 0.74,
      w: w - 0.36,
      h: 0.38,
      fontSize: 10.5,
      color: DEFAULT_MUTED,
      margin: 0,
      fit: 'shrink',
    }),
  });
  return slide;
}

export function footer(
  slide: PptxSlide,
  text: unknown,
  opts: Pick<SlideTextOpts, 'color' | 'fontSize' | 'x' | 'y' | 'w' | 'h' | 'align'> = {},
): PptxSlide {
  slide.addText(safeText(text), {
    ...textOptions({
      x: opts.x ?? 0.7,
      y: opts.y ?? 7.05,
      w: opts.w ?? 11.9,
      h: opts.h ?? 0.25,
      fontSize: opts.fontSize ?? 8,
      color: opts.color ?? '64748B',
      align: opts.align ?? 'right',
      margin: 0,
    }),
  });
  return slide;
}

export function visualPlaceholder(
  slide: PptxSlide,
  label: unknown,
  opts: SlideTextOpts & { borderColor?: string } = {},
): PptxSlide {
  const x = opts.x ?? 0.75;
  const y = opts.y ?? 1.45;
  const w = opts.w ?? 5.25;
  const h = opts.h ?? 3.6;
  slide.addShape(RECT, {
    x,
    y,
    w,
    h,
    fill: { color: cleanHex(opts.fill, 'F8FAFC') },
    line: { color: cleanHex(opts.borderColor, 'CBD5E1'), transparency: 0 },
  } satisfies ShapeOptions);
  slide.addText(safeText(label, 'Visual'), {
    ...textOptions({
      x: x + 0.2,
      y: y + h / 2 - 0.18,
      w: w - 0.4,
      h: 0.36,
      fontSize: opts.fontSize ?? 12,
      color: opts.color ?? DEFAULT_MUTED,
      align: 'center',
      valign: 'middle',
      margin: 0,
    }),
  });
  return slide;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }
  return Object.freeze(value);
}

function readonlyContext(context: PptxFreeformContext): PptxFreeformContext {
  return deepFreeze(JSON.parse(JSON.stringify(context)) as PptxFreeformContext);
}

export function getSandboxGlobals(context: PptxFreeformContext): Record<string, unknown> {
  return {
    pptx,
    titleSlide,
    sectionSlide,
    textBox,
    bullets,
    table,
    statCallout,
    footer,
    visualPlaceholder,
    safeText,
    pptxgenjs: PptxGenJS,
    PptxGenJS,
    WIDE_SLIDE,
    context: readonlyContext(context),
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
        void args;
      },
      warn: (...args: unknown[]) => {
        void args;
      },
      error: (...args: unknown[]) => {
        void args;
      },
    },
  };
}
