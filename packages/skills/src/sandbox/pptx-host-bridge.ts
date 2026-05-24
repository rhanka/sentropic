/**
 * Host-side PPTX bridge for the V8 sandbox.
 *
 * Symmetric counterpart to `docx-host-bridge.ts`. The bridge replicates the
 * legacy `getSandboxGlobals` helper API for PPTX
 * (`pptx`/`titleSlide`/`sectionSlide`/`textBox`/`bullets`/`table`/`statCallout`/
 * `footer`/`visualPlaceholder`) host-side, where the real `pptxgenjs` library
 * is loaded. Isolate-side glue exposes the same helper names through
 * `ivm.Reference.applySync` so a user script written for the legacy
 * `node:vm`-based runtime works unchanged.
 *
 * Lifecycle per `SandboxRuntime.execute()` call:
 *   1. Host calls `createPptxHostBridge()` to obtain a fresh bridge with its
 *      own handle map (no cross-skill leakage).
 *   2. The runtime installs the bridge's `__hostPptx*` references into the
 *      isolate context as part of `injectApiSurface`.
 *   3. The bootstrap glue (see `runtime.ts`) wires each `__hostPptx*` reference
 *      into a friendly sync helper inside the isolate (legacy parity).
 *   4. The user script returns the final presentation handle id.
 *   5. The host calls `packToBuffer(handle)` to produce the PPTX Buffer.
 *
 * The bridge does NOT leak `require`/`process`/`Buffer` into the isolate; only
 * `ivm.Reference`-wrapped sync function proxies are installed.
 */

// We cannot use `import pptxgenjs from 'pptxgenjs'` here because the skills
// tsconfig uses `verbatimModuleSyntax` without `esModuleInterop`, and the
// `pptxgenjs` typings expose the module as a namespace whose default export is
// the constructible class. We resolve the constructor at runtime via the same
// breadth-first walk used by `api/src/services/pptx-freeform-helpers.ts`, and
// type the module surface locally with a permissive shape.
//
// Note: `pptxgenjs` is a CJS module; the dynamic shape avoids a hard binding
// to its type exports while letting `InstanceType<PptxConstructor>` carry
// downstream typing within this file.
import * as pptxgenjsNamespace from 'pptxgenjs';

// ---------------------------------------------------------------------------
// pptxgenjs constructor resolution (mirror api/src/services/pptx-freeform-helpers.ts)
// ---------------------------------------------------------------------------

interface PptxSlideLike {
  background?: { color?: string };
  addText(text: string, opts: Record<string, unknown>): unknown;
  addShape(shape: string, opts: Record<string, unknown>): unknown;
  addTable(rows: unknown[], opts: Record<string, unknown>): unknown;
}

interface PptxPresentationLike {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  theme: { headFontFace?: string; bodyFontFace?: string };
  addSlide(): PptxSlideLike;
  write(opts: { outputType: 'nodebuffer' }): Promise<unknown>;
}

type PptxPresentation = PptxPresentationLike;
type PptxSlide = PptxSlideLike;
type PptxConstructor = new () => PptxPresentation;

type AddTextOptions = Record<string, unknown>;
type ShapeName = string;
type ShapeOptions = Record<string, unknown>;
type TableRows = unknown[];
type TableOptions = Record<string, unknown>;

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

function resolvePptxGenJSConstructor(source: unknown): PptxConstructor {
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

const PptxGenJS: PptxConstructor = resolvePptxGenJSConstructor(
  pptxgenjsNamespace as unknown,
);

// ---------------------------------------------------------------------------
// Default style constants (mirror api/src/services/pptx-freeform-helpers.ts)
// ---------------------------------------------------------------------------

const DEFAULT_FONT = 'Aptos';
const DEFAULT_HEAD_FONT = 'Aptos Display';
const DEFAULT_BG = 'FFFFFF';
const DEFAULT_TEXT = '111827';
const DEFAULT_MUTED = '475569';
const DEFAULT_ACCENT = '2563EB';
const RECT: ShapeName = 'rect';

const WIDE_SLIDE = {
  width: 13.333,
  height: 7.5,
};

function cleanHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || fallback;
}

// ---------------------------------------------------------------------------
// Handle types
// ---------------------------------------------------------------------------

const HANDLE_PREFIX = {
  presentation: 'pptx:pres:',
  slide: 'pptx:slide:',
} as const;

type PptxHandleKind = keyof typeof HANDLE_PREFIX;
type PptxBridgeNode = PptxPresentation | PptxSlide;

/**
 * Public bridge handle: opaque string identifier passed across the isolate
 * boundary. Consumers MUST treat the format as private; only the bridge can
 * resolve it.
 */
export type PptxBridgeHandle = string;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Host-side bridge for PPTX construction inside the V8 sandbox.
 *
 * Each `hostFn*` field is a synchronous host function safe to wrap with
 * `ivm.Reference` and invoke from the isolate via `applySync`. They accept
 * plain-JSON arguments (and arrays of handles for nesting) and return string
 * handle ids — except `packToBuffer` which is async (host-only).
 */
export interface PptxHostBridge {
  /** Resolve a handle to a `PptxPresentation` and pack it to a PPTX buffer. */
  packToBuffer(handle: PptxBridgeHandle): Promise<Buffer>;
  /** Number of live handles (observability/tests). */
  size(): number;
  /** Drop every retained node (called once per `execute()` for hygiene). */
  reset(): void;
  /** Internal: function map exposed to the isolate. Keys mirror legacy helper names. */
  readonly hostFns: Readonly<Record<string, (...args: unknown[]) => PptxBridgeHandle>>;
}

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

/**
 * Construct a fresh `PptxHostBridge` with isolated state. Each
 * `SandboxRuntime.execute()` call must allocate a new bridge to avoid handle
 * leakage between skills.
 */
export function createPptxHostBridge(): PptxHostBridge {
  const nodes = new Map<string, PptxBridgeNode>();
  let counter = 0;

  const mint = (kind: PptxHandleKind, node: PptxBridgeNode): string => {
    counter += 1;
    const handle = `${HANDLE_PREFIX[kind]}${counter}`;
    nodes.set(handle, node);
    return handle;
  };

  const resolvePresentation = (handle: unknown): PptxPresentation => {
    if (typeof handle !== 'string') {
      throw new TypeError(`pptx bridge: expected string handle, got ${typeof handle}`);
    }
    const node = nodes.get(handle);
    if (!node || !handle.startsWith(HANDLE_PREFIX.presentation)) {
      throw new TypeError(`pptx bridge: handle "${handle}" is not a Presentation`);
    }
    return node as PptxPresentation;
  };

  const resolveSlide = (handle: unknown): PptxSlide => {
    if (typeof handle !== 'string') {
      throw new TypeError(`pptx bridge: expected string handle, got ${typeof handle}`);
    }
    const node = nodes.get(handle);
    if (!node || !handle.startsWith(HANDLE_PREFIX.slide)) {
      throw new TypeError(`pptx bridge: handle "${handle}" is not a Slide`);
    }
    return node as PptxSlide;
  };

  const textOptions = (opts: SlideTextOpts = {}): AddTextOptions => {
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
  };

  const addBackground = (slide: PptxSlide, color: string): void => {
    slide.background = { color: cleanHex(color, DEFAULT_BG) };
  };

  // -------------------------------------------------------------------------
  // pptx(opts?) — full Presentation with sensible defaults
  // -------------------------------------------------------------------------
  const pptxFn = (optsRaw?: unknown): string => {
    const opts = (optsRaw ?? {}) as PresentationOpts;
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
    return mint('presentation', presentation);
  };

  // -------------------------------------------------------------------------
  // titleSlide(presentation, title, subtitle?, opts?)
  // -------------------------------------------------------------------------
  const titleSlideFn = (
    presentationHandle: unknown,
    titleRaw: unknown,
    subtitleRaw?: unknown,
    optsRaw?: unknown,
  ): string => {
    const presentation = resolvePresentation(presentationHandle);
    const opts = (optsRaw ?? {}) as SlideShellOpts;
    const slide = presentation.addSlide();
    addBackground(slide, opts.background ?? DEFAULT_BG);
    slide.addText(safeText(titleRaw, 'Untitled presentation'), {
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
    if (subtitleRaw !== undefined && safeText(subtitleRaw)) {
      slide.addText(safeText(subtitleRaw), {
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
    return mint('slide', slide);
  };

  // -------------------------------------------------------------------------
  // sectionSlide(presentation, title, subtitle?, opts?)
  // -------------------------------------------------------------------------
  const sectionSlideFn = (
    presentationHandle: unknown,
    titleRaw: unknown,
    subtitleRaw?: unknown,
    optsRaw?: unknown,
  ): string => {
    const presentation = resolvePresentation(presentationHandle);
    const opts = (optsRaw ?? {}) as SlideShellOpts;
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
    slide.addText(safeText(titleRaw, 'Section'), {
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
    if (subtitleRaw !== undefined && safeText(subtitleRaw)) {
      slide.addText(safeText(subtitleRaw), {
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
    return mint('slide', slide);
  };

  // -------------------------------------------------------------------------
  // textBox(slide, text, opts?) — returns the same slide handle
  // -------------------------------------------------------------------------
  const textBoxFn = (
    slideHandle: unknown,
    textRaw: unknown,
    optsRaw?: unknown,
  ): string => {
    const slide = resolveSlide(slideHandle);
    const opts = (optsRaw ?? {}) as SlideTextOpts;
    slide.addText(safeText(textRaw), textOptions(opts));
    return slideHandle as string;
  };

  // -------------------------------------------------------------------------
  // bullets(slide, items, opts?) — returns the same slide handle
  // -------------------------------------------------------------------------
  const bulletsFn = (
    slideHandle: unknown,
    itemsRaw: unknown,
    optsRaw?: unknown,
  ): string => {
    const slide = resolveSlide(slideHandle);
    const opts = (optsRaw ?? {}) as SlideTextOpts & { indent?: number };
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    const text = items.map((item) => safeText(item)).filter(Boolean).join('\n');
    slide.addText(text || ' ', {
      ...textOptions({ x: 0.85, y: 1.65, w: 11.4, h: 4.7, fontSize: 18, ...opts }),
      bullet: { type: 'bullet', indent: opts.indent ?? 18 },
      breakLine: false,
    });
    return slideHandle as string;
  };

  // -------------------------------------------------------------------------
  // table(slide, headers, rows, opts?) — returns the same slide handle
  // -------------------------------------------------------------------------
  const tableFn = (
    slideHandle: unknown,
    headersRaw: unknown,
    rowsRaw: unknown,
    optsRaw?: unknown,
  ): string => {
    const slide = resolveSlide(slideHandle);
    const opts = (optsRaw ?? {}) as TableOpts;
    const headers = Array.isArray(headersRaw) ? headersRaw : [];
    const rows = Array.isArray(rowsRaw)
      ? rowsRaw.map((r) => (Array.isArray(r) ? r : []))
      : [];
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
    return slideHandle as string;
  };

  // -------------------------------------------------------------------------
  // statCallout(slide, label, value, opts?) — returns the same slide handle
  // -------------------------------------------------------------------------
  const statCalloutFn = (
    slideHandle: unknown,
    labelRaw: unknown,
    valueRaw: unknown,
    optsRaw?: unknown,
  ): string => {
    const slide = resolveSlide(slideHandle);
    const opts = (optsRaw ?? {}) as SlideTextOpts & { accent?: string };
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
    slide.addText(safeText(valueRaw, '0'), {
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
    slide.addText(safeText(labelRaw), {
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
    return slideHandle as string;
  };

  // -------------------------------------------------------------------------
  // footer(slide, text, opts?) — returns the same slide handle
  // -------------------------------------------------------------------------
  const footerFn = (
    slideHandle: unknown,
    textRaw: unknown,
    optsRaw?: unknown,
  ): string => {
    const slide = resolveSlide(slideHandle);
    const opts = (optsRaw ?? {}) as Pick<
      SlideTextOpts,
      'color' | 'fontSize' | 'x' | 'y' | 'w' | 'h' | 'align'
    >;
    slide.addText(safeText(textRaw), {
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
    return slideHandle as string;
  };

  // -------------------------------------------------------------------------
  // visualPlaceholder(slide, label, opts?) — returns the same slide handle
  // -------------------------------------------------------------------------
  const visualPlaceholderFn = (
    slideHandle: unknown,
    labelRaw: unknown,
    optsRaw?: unknown,
  ): string => {
    const slide = resolveSlide(slideHandle);
    const opts = (optsRaw ?? {}) as SlideTextOpts & { borderColor?: string };
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
    slide.addText(safeText(labelRaw, 'Visual'), {
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
    return slideHandle as string;
  };

  const hostFns = Object.freeze({
    __hostPptxPres: pptxFn as (...args: unknown[]) => string,
    __hostPptxTitleSlide: titleSlideFn as (...args: unknown[]) => string,
    __hostPptxSectionSlide: sectionSlideFn as (...args: unknown[]) => string,
    __hostPptxTextBox: textBoxFn as (...args: unknown[]) => string,
    __hostPptxBullets: bulletsFn as (...args: unknown[]) => string,
    __hostPptxTable: tableFn as (...args: unknown[]) => string,
    __hostPptxStatCallout: statCalloutFn as (...args: unknown[]) => string,
    __hostPptxFooter: footerFn as (...args: unknown[]) => string,
    __hostPptxVisualPlaceholder: visualPlaceholderFn as (...args: unknown[]) => string,
  });

  return {
    hostFns,
    size: () => nodes.size,
    reset: () => nodes.clear(),
    async packToBuffer(handle: PptxBridgeHandle): Promise<Buffer> {
      const presentation = resolvePresentation(handle);
      const output = await presentation.write({ outputType: 'nodebuffer' });
      if (Buffer.isBuffer(output)) return output;
      if (output instanceof Uint8Array) return Buffer.from(output);
      if (output instanceof ArrayBuffer) return Buffer.from(output);
      if (typeof Blob !== 'undefined' && output instanceof Blob) {
        return Buffer.from(await output.arrayBuffer());
      }
      if (typeof output === 'string') return Buffer.from(output, 'binary');
      throw new Error('pptx bridge: unsupported PptGenJS output type');
    },
  };
}

/**
 * Bootstrap glue source injected into the isolate context to wire the
 * `__hostPptx*` references into legacy-shaped sync helpers (`pptx`,
 * `titleSlide`, `sectionSlide`, `textBox`, `bullets`, `table`, `statCallout`,
 * `footer`, `visualPlaceholder`). The script keeps the legacy helper
 * signatures intact so a fixture authored against `getSandboxGlobals` runs
 * unchanged.
 */
export const PPTX_BRIDGE_BOOTSTRAP = `
const __callPptxSync = (ref) => (...args) =>
  ref.applySync(undefined, args, { arguments: { copy: true }, result: { copy: true } });
const pptx = __callPptxSync(__hostPptxPres);
const titleSlide = __callPptxSync(__hostPptxTitleSlide);
const sectionSlide = __callPptxSync(__hostPptxSectionSlide);
const textBox = __callPptxSync(__hostPptxTextBox);
const bullets = __callPptxSync(__hostPptxBullets);
const table = __callPptxSync(__hostPptxTable);
const statCallout = __callPptxSync(__hostPptxStatCallout);
const footer = __callPptxSync(__hostPptxFooter);
const visualPlaceholder = __callPptxSync(__hostPptxVisualPlaceholder);
`;
