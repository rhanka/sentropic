/**
 * Text extraction helpers for document summarization.
 * MVP requirement: support pdf, docx, pptx, xlsx, md.
 */
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

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

function isXlsxDocument(mimeType: string, fileName: string): boolean {
  return mimeType === XLSX_MIME_TYPE || fileName.endsWith('.xlsx');
}

type XmlNodeListLike = {
  length: number;
  item(index: number): XmlElementLike | null;
};

type XmlElementLike = {
  getAttribute?(name: string): string | null;
  getElementsByTagName?(tagName: string): XmlNodeListLike;
  textContent?: string | null;
};

function parseXml(xml: string): XmlElementLike {
  return new DOMParser().parseFromString(xml, 'application/xml') as unknown as XmlElementLike;
}

function xmlElements(parent: XmlElementLike | null | undefined, tagName: string): XmlElementLike[] {
  const nodes = parent?.getElementsByTagName?.(tagName);
  if (!nodes || typeof nodes.length !== 'number') return [];
  const out: XmlElementLike[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes.item(i);
    if (node) out.push(node);
  }
  return out;
}

function xmlAttribute(node: XmlElementLike | null | undefined, name: string): string | null {
  const value = node?.getAttribute?.(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function xmlText(node: XmlElementLike | null | undefined): string {
  const value = node?.textContent;
  return typeof value === 'string' ? value : '';
}

function normalizeCellText(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeZipPath(input: string): string {
  const parts: string[] = [];
  for (const part of input.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function resolveWorkbookTarget(target: string): string {
  if (target.startsWith('/')) return normalizeZipPath(target);
  if (target.startsWith('xl/')) return normalizeZipPath(target);
  return normalizeZipPath(`xl/${target}`);
}

function columnIndexFromReference(reference: string | null): number | null {
  if (!reference) return null;
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return null;
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index > 0 ? index - 1 : null;
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async('text') : null;
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const doc = parseXml(xml);
  return xmlElements(doc, 'si').map((si) =>
    xmlElements(si, 't')
      .map((node) => xmlText(node))
      .join(''),
  );
}

function readWorkbookSheets(workbookXml: string | null, relationshipsXml: string | null): Array<{
  name: string;
  path: string;
}> {
  if (!workbookXml) return [];
  const rels = new Map<string, string>();
  if (relationshipsXml) {
    for (const rel of xmlElements(parseXml(relationshipsXml), 'Relationship')) {
      const id = xmlAttribute(rel, 'Id');
      const target = xmlAttribute(rel, 'Target');
      if (id && target) rels.set(id, resolveWorkbookTarget(target));
    }
  }

  return xmlElements(parseXml(workbookXml), 'sheet')
    .map((sheet) => {
      const name = xmlAttribute(sheet, 'name') ?? 'Sheet';
      const relationshipId = xmlAttribute(sheet, 'r:id');
      const path = relationshipId ? rels.get(relationshipId) : null;
      return path ? { name, path } : null;
    })
    .filter((sheet): sheet is { name: string; path: string } => Boolean(sheet));
}

function readCellValue(cell: XmlElementLike, sharedStrings: string[]): string {
  const type = xmlAttribute(cell, 't');

  if (type === 'inlineStr') {
    return normalizeCellText(
      xmlElements(cell, 't')
        .map((node) => xmlText(node))
        .join(''),
    );
  }

  const raw = normalizeCellText(xmlText(xmlElements(cell, 'v')[0]));
  if (!raw) return '';
  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    return Number.isFinite(index) ? normalizeCellText(sharedStrings[index] ?? raw) : raw;
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw;
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xmlElements(parseXml(xml), 'row')) {
    const values: string[] = [];
    let nextColumnIndex = 0;
    for (const cell of xmlElements(row, 'c')) {
      const explicitColumnIndex = columnIndexFromReference(xmlAttribute(cell, 'r'));
      const columnIndex = explicitColumnIndex ?? nextColumnIndex;
      while (values.length < columnIndex) values.push('');
      values[columnIndex] = readCellValue(cell, sharedStrings);
      nextColumnIndex = columnIndex + 1;
    }
    while (values.length > 0 && !values[values.length - 1]) values.pop();
    if (values.some((value) => value.trim().length > 0)) rows.push(values);
  }
  return rows;
}

async function extractXlsxDocumentInfo(params: {
  bytes: Uint8Array;
  filename?: string | null;
}): Promise<ExtractedDocumentInfo> {
  const zip = await JSZip.loadAsync(Buffer.from(params.bytes));
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  const relationshipsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = readSharedStrings(await readZipText(zip, 'xl/sharedStrings.xml'));
  const workbookSheets = readWorkbookSheets(workbookXml, relationshipsXml);
  const sheets =
    workbookSheets.length > 0
      ? workbookSheets
      : Object.keys(zip.files)
          .filter((path) => /^xl\/worksheets\/[^/]+\.xml$/i.test(path))
          .sort()
          .map((path, index) => ({ name: `Sheet ${index + 1}`, path }));

  const sections: string[] = [];
  const headingsH1: string[] = [];
  for (const sheet of sheets) {
    const worksheetXml = await readZipText(zip, sheet.path);
    if (!worksheetXml) continue;
    const rows = extractWorksheetRows(worksheetXml, sharedStrings);
    if (rows.length === 0) continue;
    headingsH1.push(sheet.name);
    sections.push([`Sheet: ${sheet.name}`, ...rows.map((row) => row.join('\t'))].join('\n'));
  }

  const text = sections.join('\n\n').trim();
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

  // Office / PDF via officeparser@6
  // NOTE: officeparser has a brittle CLI detection that assumes process.argv[1] exists in some environments.
  if (!process.argv[1]) process.argv[1] = 'app';

  const mod = (await import('officeparser')) as unknown as {
    parseOffice: (file: unknown, config?: Record<string, unknown>) => Promise<unknown>;
  };

  const buf = Buffer.from(params.bytes);
  const ast = await mod.parseOffice(buf, { outputErrorToConsole: false });

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
