/**
 * Text extraction helpers for document summarization.
 * MVP requirement: support pdf, docx, pptx, xlsx, md.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

type ExtractedDocumentMetadata = {
  title?: string;
  author?: string;
  lastModifiedBy?: string;
  created?: string;
  modified?: string;
  description?: string;
  subject?: string;
  pages?: number;
  words?: number;
};

export type ExtractedDocumentInfo = {
  text: string;
  metadata: ExtractedDocumentMetadata;
  headingsH1: string[]; // best-effort, empty if not available
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coerceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function coerceNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function coerceDateIso(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return undefined;
}

function countWords(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/g).filter(Boolean).length;
}

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isXlsxDocument(mimeType: string, fileName: string): boolean {
  return mimeType === XLSX_MIME_TYPE || fileName.toLowerCase().endsWith('.xlsx');
}

/** One extracted worksheet: tab-separated content where formula cells surface formula + value. */
export type ExtractedSheet = {
  name: string;
  /** 1-based sheet position in the workbook. */
  index: number;
  /** Number of non-empty rows captured in `text`. */
  rowCount: number;
  /** Tab-separated rows, no `Sheet:` header (caller adds labelling where relevant). */
  text: string;
};

function normalizeCellText(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Render a single exceljs cell to a string.
 * - Formula cells surface BOTH the formula and the computed value: `=FORMULA → value`
 *   (Anthropic xlsx skill principle: preserve formulas, never collapse them to values).
 * - Shared formulas (`sharedFormula`) resolve to the master formula via `cell.formula`.
 * - Dates are normalized to ISO; other types use exceljs' own `text` rendering.
 */
function renderCell(cell: ExcelJS.Cell): string {
  const value = cell.value as unknown;

  if (value === null || value === undefined) return '';

  // Formula cell: exceljs exposes { formula, result } (and { sharedFormula, result } for shared).
  if (cell.type === ExcelJS.ValueType.Formula || (typeof value === 'object' && value !== null && ('formula' in value || 'sharedFormula' in value))) {
    const formula = typeof cell.formula === 'string' && cell.formula.trim() ? cell.formula.trim() : null;
    const resultText = renderFormulaResult(cell);
    if (formula && resultText) return normalizeCellText(`=${formula} → ${resultText}`);
    if (formula) return normalizeCellText(`=${formula}`);
    return normalizeCellText(resultText);
  }

  if (cell.type === ExcelJS.ValueType.Date && value instanceof Date) {
    return value.toISOString();
  }

  // Booleans, numbers, strings, hyperlinks, rich text, errors: exceljs `text` is a sane string.
  const text = cell.text;
  return typeof text === 'string' ? normalizeCellText(text) : normalizeCellText(String(value));
}

function renderFormulaResult(cell: ExcelJS.Cell): string {
  const raw = cell.result as unknown;
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'object') {
    // Formula error results surface as { error: '#DIV/0!' }.
    const error = (raw as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    const text = cell.text;
    return typeof text === 'string' ? normalizeCellText(text) : '';
  }
  return normalizeCellText(String(raw));
}

function extractSheetRows(worksheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (values.length < colNumber - 1) values.push('');
      values[colNumber - 1] = renderCell(cell);
    });
    while (values.length > 0 && !values[values.length - 1]) values.pop();
    if (values.some((value) => value.trim().length > 0)) rows.push(values);
  });
  return rows;
}

async function loadXlsxWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs accepts a Node Buffer; copy into a standalone ArrayBuffer-backed Buffer to be safe.
  await workbook.xlsx.load(Buffer.from(bytes));
  return workbook;
}

/**
 * Structured per-sheet extraction for the documentary query tool (`list_sheets` / `get_sheet_content`).
 * Each sheet's `text` is tab-separated rows; formula cells surface `=FORMULA → value`.
 * Empty sheets are skipped (no rows captured) to mirror the flattened indexing behavior.
 */
export async function extractXlsxSheets(bytes: Uint8Array): Promise<ExtractedSheet[]> {
  const workbook = await loadXlsxWorkbook(bytes);
  const sheets: ExtractedSheet[] = [];
  let position = 0;
  workbook.eachSheet((worksheet) => {
    position += 1;
    const rows = extractSheetRows(worksheet);
    if (rows.length === 0) return;
    const name = worksheet.name?.trim() ? worksheet.name.trim() : `Sheet ${position}`;
    sheets.push({
      name,
      index: position,
      rowCount: rows.length,
      text: rows.map((row) => row.join('\t')).join('\n'),
    });
  });
  return sheets;
}

async function extractXlsxDocumentInfo(params: {
  bytes: Uint8Array;
  filename?: string | null;
}): Promise<ExtractedDocumentInfo> {
  const sheets = await extractXlsxSheets(params.bytes);

  const headingsH1 = sheets.map((sheet) => sheet.name);
  const text = sheets
    .map((sheet) => [`Sheet: ${sheet.name}`, sheet.text].join('\n'))
    .join('\n\n')
    .trim();

  const metadata: ExtractedDocumentMetadata = {};
  const title = params.filename?.trim();
  if (title) metadata.title = title;
  const words = countWords(text);
  if (words > 0) metadata.words = words;
  return { text, metadata, headingsH1 };
}

function extractHeadingsH1FromAst(ast: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown) => {
    if (!isRecord(node)) return;
    const type = node.type;
    const text = node.text;
    const children = node.children;
    const metadata = node.metadata;

    if (type === 'heading' && typeof text === 'string' && isRecord(metadata)) {
      const level = metadata.level;
      if (level === 1) {
        const t = text.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
    }

    if (Array.isArray(children)) {
      for (const c of children) walk(c);
    }
  };

  if (isRecord(ast) && Array.isArray(ast.content)) {
    for (const top of ast.content) walk(top);
  }

  return out;
}

function extractPdfPageCountFromAst(ast: unknown): number | undefined {
  if (!isRecord(ast)) return undefined;
  if (ast.type !== 'pdf') return undefined;
  const content = ast.content;
  if (!Array.isArray(content)) return undefined;

  // officeparser PDF parser commonly returns `content` as an array of page nodes, with metadata.pageNumber.
  const pageNums = new Set<number>();
  for (const node of content) {
    if (!isRecord(node)) continue;
    const md = node.metadata;
    if (isRecord(md)) {
      const pn = md.pageNumber;
      if (typeof pn === 'number' && Number.isFinite(pn) && pn > 0) pageNums.add(pn);
    }
  }
  if (pageNums.size > 0) {
    const max = Math.max(...pageNums);
    return max;
  }

  // Fallback: count top-level nodes if they look like pages.
  const pageLike = content.filter((n) => isRecord(n) && n.type === 'page').length;
  if (pageLike > 0) {
    return pageLike;
  }
  return undefined;
}

/**
 * Office/PDF extensions officeparser dispatches on (its `switch (ext)`).
 * We resolve the extension ourselves from the known mime type and filename so
 * officeparser never has to guess from raw bytes.
 *
 * WHY: when `parseOffice` receives a Buffer (no path/extension) it delegates type
 * detection to `file-type` magic-byte sniffing. For real-world OOXML files
 * (docx/pptx/xlsx are ZIP containers) `file-type@22` regularly fails to classify
 * the archive — the OOXML markers (`[Content_Types].xml`, `word/`/`ppt/`/`xl/`)
 * fall outside its bounded scan budget — and returns plain `zip`. officeparser
 * then hits its `default:` branch and throws
 * "Sorry, OfficeParser currently supports docx, pptx, xlsx, ... files only.
 *  ... add support for zip files", even though the file IS a valid docx.
 * Routing on the extension we already know avoids the sniffing entirely.
 */
const OFFICE_MIME_TO_EXT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/pdf': 'pdf',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
};

const OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'pdf', 'rtf']);

/** Resolve the officeparser extension from mime first, then filename suffix. */
function resolveOfficeExtension(mime: string, name: string): string | null {
  const fromMime = OFFICE_MIME_TO_EXT[mime];
  if (fromMime) return fromMime;
  const dot = name.lastIndexOf('.');
  if (dot >= 0) {
    const ext = name.slice(dot + 1);
    if (OFFICE_EXTENSIONS.has(ext)) return ext;
  }
  return null;
}

/**
 * Parse an office/PDF document via officeparser.
 * Always routes through a temp file carrying the correct extension so officeparser
 * uses its reliable extension dispatch instead of fragile byte-sniffing (see
 * OFFICE_MIME_TO_EXT note). Falls back to the raw Buffer only when we cannot
 * determine an extension (officeparser then sniffs, matching legacy behavior).
 */
async function parseOfficeDocument(bytes: Uint8Array, ext: string | null): Promise<unknown> {
  // NOTE: officeparser has a brittle CLI detection that assumes process.argv[1] exists.
  if (!process.argv[1]) process.argv[1] = 'app';

  const mod = (await import('officeparser')) as unknown as {
    parseOffice: (file: unknown, config?: Record<string, unknown>) => Promise<unknown>;
  };

  const buf = Buffer.from(bytes);
  if (!ext) {
    return mod.parseOffice(buf, { outputErrorToConsole: false });
  }

  const dir = await mkdtemp(join(tmpdir(), 'docparse-'));
  const file = join(dir, `${randomBytes(8).toString('hex')}.${ext}`);
  try {
    await writeFile(file, buf);
    return await mod.parseOffice(file, { outputErrorToConsole: false });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractDocumentInfoFromDocument(params: {
  bytes: Uint8Array;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<ExtractedDocumentInfo> {
  const mime = (params.mimeType || '').toLowerCase();
  const name = (params.filename || '').toLowerCase();

  const isMarkdown = mime === 'text/markdown' || name.endsWith('.md') || name.endsWith('.markdown');
  const isTextLike = mime.startsWith('text/') || mime.includes('json') || isMarkdown;

  if (isXlsxDocument(mime, name)) {
    return extractXlsxDocumentInfo(params);
  }

  if (isTextLike) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(params.bytes);
    const metadata: ExtractedDocumentMetadata = {};
    const words = countWords(text);
    if (words > 0) metadata.words = words;
    return { text, metadata, headingsH1: [] };
  }

  // Office / PDF via officeparser@6.
  // Resolve the extension from the known mime/filename so officeparser uses its
  // reliable extension dispatch instead of byte-sniffing (which mis-detects many
  // real-world docx/pptx/xlsx as plain "zip" and throws "unsupported").
  const ext = resolveOfficeExtension(mime, name);
  const ast = await parseOfficeDocument(params.bytes, ext);

  // v6 returns an AST with a toText() helper.
  const maybeAst = ast as { toText?: () => string } | null;
  const text = maybeAst && typeof maybeAst.toText === 'function' ? maybeAst.toText() : '';

  // Metadata: best-effort mapping from officeparser OfficeMetadata -> plain JSON (dates to ISO).
  const metadata: ExtractedDocumentMetadata = {};
  if (isRecord(ast) && isRecord(ast.metadata)) {
    const m = ast.metadata;
    metadata.title = coerceString(m.title);
    metadata.author = coerceString(m.author);
    metadata.lastModifiedBy = coerceString(m.lastModifiedBy);
    metadata.description = coerceString(m.description);
    metadata.subject = coerceString(m.subject);
    metadata.pages = coerceNumber(m.pages);
    metadata.words = coerceNumber((m as Record<string, unknown>).words);
    metadata.created = coerceDateIso(m.created);
    metadata.modified = coerceDateIso(m.modified);
  }

  // Best-effort PDF pages fallback: if officeparser didn't populate metadata.pages, infer from AST.
  if (metadata.pages === undefined) {
    const inferredPages = extractPdfPageCountFromAst(ast);
    if (typeof inferredPages === 'number' && inferredPages > 0) metadata.pages = inferredPages;
  }

  // Best-effort words fallback: compute from extracted text when metadata isn't available.
  if (metadata.words === undefined) {
    const words = countWords(text);
    if (words > 0) metadata.words = words;
  }

  const headingsH1 = extractHeadingsH1FromAst(ast);

  if (text) return { text, metadata, headingsH1 };

  // Fallbacks
  if (typeof ast === 'string') return { text: ast, metadata, headingsH1 };
  try {
    return { text: JSON.stringify(ast), metadata, headingsH1 };
  } catch {
    return { text: String(ast ?? ''), metadata, headingsH1 };
  }
}

// Back-compat helper: older call sites expect just text.
export async function extractTextFromDocument(params: {
  bytes: Uint8Array;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<string> {
  const { text } = await extractDocumentInfoFromDocument(params);
  return text;
}
