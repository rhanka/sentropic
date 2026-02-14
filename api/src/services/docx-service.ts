/**
 * DOCX generation service using dolanmiu/docx.
 *
 * Strategy:
 * 1) load the .docx template from api/templates
 * 2) expand FOR/END-FOR loop blocks directly in word/document.xml
 * 3) patch placeholders with docx.patchDocument while preserving template styles
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, posix as pathPosix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  ExternalHyperlink,
  ImageRun,
  PatchType,
  TextRun,
  patchDetector,
  patchDocument,
  type IPatch,
  type ParagraphChild,
} from 'docx';
import { marked } from 'marked';
import type { MatrixConfig } from '../types/matrix';
import type { UseCase } from '../types/usecase';
import { fibonacciToStars } from '../utils/fibonacci-mapping';
import { getDocumentsBucketName, getObjectBytes } from './storage-s3';

type InlineStyle = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
};

type MarkedToken = {
  type: string;
  text?: string;
  raw?: string;
  href?: string;
  ordered?: boolean;
  start?: number;
  tokens?: MarkedToken[];
  items?: Array<{
    text?: string;
    tokens?: MarkedToken[];
  }>;
};

type PatchMode = 'plain' | 'markdown_inline' | 'markdown_block' | 'image';

type ImagePatchValue = {
  type: 'jpg' | 'png' | 'gif' | 'bmp';
  data: Buffer;
  widthPx: number;
  heightPx: number;
};

type PatchPayload = {
  mode: PatchMode;
  value: unknown;
};

type DashboardImageInput = {
  dataBase64?: string;
  dataUrl?: string;
  mimeType?: string;
  assetId?: string;
  widthPx?: number;
  heightPx?: number;
};

export type DocxTemplateId = 'usecase-onepage' | 'executive-synthesis-multipage';
export type DocxEntityType = 'usecase' | 'folder';

type BaseRunStyle = {
  style?: string;
  font?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
};

type TemplateData = {
  name: string;
  description: string;
  problem: string;
  solution: string;
  process: string;
  domain: string;
  technologies: string[];
  benefits: string[];
  metrics: string[];
  risks: string[];
  constraints: string[];
  nextSteps: string[];
  dataSources: string[];
  dataObjects: string[];
  references: Array<{
    title: string;
    url: string;
    link: string;
    excerpt: string;
  }>;
  valueAxes: Array<{
    title: string;
    score: number;
    stars: string;
    crosses: string;
    description: string;
  }>;
  complexityAxes: Array<{
    title: string;
    score: number;
    stars: string;
    crosses: string;
    description: string;
  }>;
  deadline: string;
  contact: string;
  totalValueScore: number | '';
  totalComplexityScore: number | '';
  totalValueStars: string;
  totalComplexityStars: string;
  totalComplexityCrosses: string;
};

type ExecutiveSummaryReference = {
  title?: string;
  url?: string;
  excerpt?: string;
};

type ExecutiveSummaryContent = {
  introduction?: string;
  analyse?: string;
  recommandation?: string;
  synthese_executive?: string;
  references?: ExecutiveSummaryReference[];
};

export type ExecutiveSynthesisDocxInput = {
  folderName: string;
  executiveSummary: ExecutiveSummaryContent;
  useCases: UseCase[];
  matrix: MatrixConfig | null;
  provided?: Record<string, unknown>;
  controls?: Record<string, unknown>;
  locale?: string;
  requestId?: string;
  onProgress?: (event: {
    state: string;
    progress?: number;
    current?: number;
    total?: number;
    message?: string;
  }) => void | Promise<void>;
};

type LoopExpansionState = {
  counter: number;
  loopPatches: Record<string, PatchPayload>;
  includeCounter: number;
  includeTemplateXmlCache: Map<string, string>;
  masterZip: JSZip;
  masterRelationships: RelationshipState;
  masterNamespaces: Map<string, string>;
  masterIgnorablePrefixes: Set<string>;
  additionalNamespaces: Map<string, string>;
  additionalIgnorablePrefixes: Set<string>;
  nextDocPrId: number;
  nextBookmarkId: number;
  requestId?: string;
  onAnnexProgress?: (current: number, total: number) => void | Promise<void>;
};

type LoopMatch = {
  startIndex: number;
  startToken: string;
  loopVar: string;
  loopExpr: string;
  endIndex: number;
  endToken: string;
};

type XmlRange = {
  start: number;
  end: number;
};

type RenderCallbacks = {
  onAnnexProgress?: (current: number, total: number) => void | Promise<void>;
  onPatchStart?: () => void | Promise<void>;
};

type RootInfo = {
  namespaces: Map<string, string>;
  ignorablePrefixes: Set<string>;
};

type PlaceholderInstance = {
  sourcePlaceholder: string;
  baseStyle: BaseRunStyle;
};

type RelationshipEntry = {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
};

type RelationshipState = {
  entries: RelationshipEntry[];
  entryById: Map<string, RelationshipEntry>;
  usedIds: Set<string>;
  nextSyntheticId: number;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_TEMPLATES_DIR = resolve(__dirname, '../../templates');
const CWD_TEMPLATES_DIR = resolve(process.cwd(), 'templates');
const TEMPLATES_DIR = existsSync(CWD_TEMPLATES_DIR)
  ? CWD_TEMPLATES_DIR
  : MODULE_TEMPLATES_DIR;

const MARKDOWN_BLOCK_FIELDS = new Set([
  'description',
  'problem',
  'solution',
  'introduction',
  'analyse',
  'recommandation',
  'synthese_executive',
  'references',
  'excerpt',
]);

const DASHBOARD_IMAGE_MAX_WIDTH_PX = 1200;
const DASHBOARD_IMAGE_MAX_HEIGHT_PX = 675;
const DASHBOARD_IMAGE_MIN_PX = 32;

marked.setOptions({
  gfm: true,
  breaks: true,
});

function safeText(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\r\n/g, '\n');
}

function logDocx(message: string, requestId?: string): void {
  const prefix = requestId ? `[DOCX:${requestId}]` : '[DOCX]';
  console.log(`${prefix} ${message}`);
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item));
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/[[\]]/g, '\\$&');
}

function toMarkdownLink(title: string, url: string): string {
  const text = safeText(title).trim() || safeText(url).trim();
  const href = safeText(url).trim();
  if (!href) return text;
  return `[${escapeMarkdownLinkLabel(text)}](${href})`;
}

function inlineTokensFromMarkdown(markdown: string): MarkedToken[] {
  const source = safeText(markdown);
  if (!source.trim()) return [];

  const blockTokens = marked.lexer(source) as unknown as MarkedToken[];
  if (blockTokens.length === 1 && Array.isArray(blockTokens[0].tokens)) {
    return blockTokens[0].tokens ?? [];
  }

  return [{ type: 'text', text: source }];
}

function newTextRun(text: string, style: InlineStyle, base: BaseRunStyle = {}): TextRun {
  const bold = style.bold ? true : base.bold;
  const italics = style.italic ? true : base.italic;
  const strike = style.strike ? true : base.strike;

  return new TextRun({
    text,
    style: base.style,
    bold,
    italics,
    strike,
    font: style.code ? 'Courier New' : base.font,
    size: base.size,
    color: base.color,
  });
}

function inlineTokensToRuns(
  tokens: MarkedToken[],
  style: InlineStyle = { bold: false, italic: false, strike: false, code: false },
  baseStyle: BaseRunStyle = {}
): ParagraphChild[] {
  const out: ParagraphChild[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'strong': {
        const childTokens = token.tokens ?? inlineTokensFromMarkdown(token.text ?? token.raw ?? '');
        out.push(...inlineTokensToRuns(childTokens, { ...style, bold: true }, baseStyle));
        break;
      }
      case 'em': {
        const childTokens = token.tokens ?? inlineTokensFromMarkdown(token.text ?? token.raw ?? '');
        out.push(...inlineTokensToRuns(childTokens, { ...style, italic: true }, baseStyle));
        break;
      }
      case 'del': {
        const childTokens = token.tokens ?? inlineTokensFromMarkdown(token.text ?? token.raw ?? '');
        out.push(...inlineTokensToRuns(childTokens, { ...style, strike: true }, baseStyle));
        break;
      }
      case 'codespan':
        out.push(newTextRun(safeText(token.text), { ...style, code: true }, baseStyle));
        break;
      case 'link': {
        const href = safeText(token.href);
        const childTokens = token.tokens ?? inlineTokensFromMarkdown(token.text ?? token.href ?? '');
        const linkChildren = inlineTokensToRuns(childTokens, style, baseStyle);

        if (href) {
          out.push(
            new ExternalHyperlink({
              link: href,
              children: linkChildren.length > 0 ? linkChildren : [newTextRun(href, style, baseStyle)],
            })
          );
        } else {
          out.push(...linkChildren);
        }
        break;
      }
      case 'br':
        out.push(
          new TextRun({
            text: '',
            break: 1,
            font: baseStyle.font,
            size: baseStyle.size,
            color: baseStyle.color,
          })
        );
        break;
      case 'escape':
      case 'text':
      default:
        out.push(newTextRun(safeText(token.text ?? token.raw), style, baseStyle));
        break;
    }
  }

  return out;
}

function markdownToInlineChildren(markdown: string, baseStyle: BaseRunStyle = {}): ParagraphChild[] {
  const source = safeText(markdown);
  if (!source.trim()) return [];
  return inlineTokensToRuns(inlineTokensFromMarkdown(source), undefined, baseStyle);
}

function markdownToBlockChildren(markdown: string, baseStyle: BaseRunStyle = {}): ParagraphChild[] {
  const source = safeText(markdown);
  if (!source.trim()) return [];

  const tokens = marked.lexer(source) as unknown as MarkedToken[];
  const lines: ParagraphChild[][] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'paragraph':
      case 'text':
      case 'heading': {
        const childTokens = token.tokens ?? inlineTokensFromMarkdown(token.text ?? token.raw ?? '');
        const children = inlineTokensToRuns(childTokens, undefined, baseStyle);
        if (children.length > 0) lines.push(children);
        break;
      }
      case 'list': {
        const isOrdered = token.ordered === true;
        const startAt = typeof token.start === 'number' ? token.start : 1;

        for (const [index, item] of (token.items ?? []).entries()) {
          const itemText = safeText(item.text).trim();
          if (!itemText) continue;

          const itemTokens = inlineTokensFromMarkdown(itemText);
          const marker = isOrdered ? `${startAt + index}. ` : '• ';
          const lineChildren: ParagraphChild[] = [
            newTextRun(marker, { bold: false, italic: false, strike: false, code: false }, baseStyle),
            ...inlineTokensToRuns(itemTokens, undefined, baseStyle),
          ];
          if (lineChildren.length > 0) lines.push(lineChildren);
        }
        break;
      }
      case 'code': {
        const codeLines = safeText(token.text).split('\n');
        for (const codeLine of codeLines) {
          lines.push([
            new TextRun({
              text: codeLine,
              font: 'Courier New',
              size: baseStyle.size,
              color: baseStyle.color,
            }),
          ]);
        }
        break;
      }
      default:
        break;
    }
  }

  const out: ParagraphChild[] = [];
  lines.forEach((line, index) => {
      out.push(...line);
      if (index < lines.length - 1) {
        out.push(
          new TextRun({
            text: '',
            break: 1,
            font: baseStyle.font,
            size: baseStyle.size,
            color: baseStyle.color,
          })
        );
      }
  });

  return out;
}

function toPatch(payload: PatchPayload, baseStyle: BaseRunStyle = {}): IPatch {
  let children: ParagraphChild[] = [];

  if (payload.mode === 'image') {
    const image = payload.value as ImagePatchValue | null;
    if (image?.data && image.widthPx > 0 && image.heightPx > 0) {
      children = [
        new ImageRun({
          type: image.type,
          data: image.data,
          transformation: {
            width: image.widthPx,
            height: image.heightPx,
          },
        }),
      ];
    }
  } else if (payload.mode === 'markdown_inline') {
    children = markdownToInlineChildren(safeText(payload.value), baseStyle);
  } else if (payload.mode === 'markdown_block') {
    children = markdownToBlockChildren(safeText(payload.value), baseStyle);
  } else {
    children = safeText(payload.value)
      ? [newTextRun(safeText(payload.value), { bold: false, italic: false, strike: false, code: false }, baseStyle)]
      : [];
  }

  return {
    type: PatchType.PARAGRAPH,
    children: children.length > 0 ? children : [new TextRun('')],
  };
}

function resolvePath(target: unknown, path: string): unknown {
  const normalized = path.trim().replace(/^\$/, '');
  if (!normalized) return target;

  return normalized.split('.').reduce<unknown>((acc, part) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(part);
      if (Number.isNaN(index)) return undefined;
      return acc[index];
    }
    if (typeof acc === 'object' && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, target);
}

function normalizeIncludeTemplateRef(ref: string): string {
  const trimmed = safeText(ref).trim();
  if (trimmed.startsWith('template.')) {
    return trimmed.slice('template.'.length);
  }
  return trimmed;
}

function loopExprCandidates(loopExpr: string): string[] {
  return loopExpr
    .split('||')
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveExpression(target: Record<string, unknown>, expr: string): unknown {
  const candidates = loopExprCandidates(expr);
  if (candidates.length === 0) return undefined;

  for (const candidate of candidates) {
    if (candidate === '[]') return [];
    if (candidate === '{}') return {};
    if (candidate === '""' || candidate === "''") return '';

    const resolved = resolvePath(target, candidate);
    if (resolved !== undefined && resolved !== null) {
      return resolved;
    }
  }

  return undefined;
}

function loopExprToPath(loopExpr: string): string {
  return loopExpr.split('||')[0]?.trim() ?? loopExpr.trim();
}

const EMPTY_RELATIONSHIPS_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function parseXmlAttributes(fragment: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRegex = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(fragment)) != null) {
    attrs.set(attrMatch[1], attrMatch[2]);
  }
  return attrs;
}

function parseRootInfo(documentXml: string): RootInfo {
  const rootTagMatch = documentXml.match(/<w:document\b[^>]*>/);
  if (!rootTagMatch) {
    return { namespaces: new Map<string, string>(), ignorablePrefixes: new Set<string>() };
  }

  const namespaces = new Map<string, string>();
  const ignorablePrefixes = new Set<string>();
  const attrRegex = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrRegex.exec(rootTagMatch[0])) != null) {
    const attr = attrMatch[1];
    const value = attrMatch[2];
    if (attr.startsWith('xmlns:')) {
      namespaces.set(attr.slice('xmlns:'.length), value);
      continue;
    }
    if (attr === 'mc:Ignorable') {
      value
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => ignorablePrefixes.add(entry));
    }
  }

  return { namespaces, ignorablePrefixes };
}

function applyRootInfo(
  documentXml: string,
  state: Pick<
    LoopExpansionState,
    'masterNamespaces' | 'masterIgnorablePrefixes' | 'additionalNamespaces' | 'additionalIgnorablePrefixes'
  >
): string {
  const rootTagMatch = documentXml.match(/<w:document\b[^>]*>/);
  if (!rootTagMatch) return documentXml;

  let rootTag = rootTagMatch[0];

  for (const [prefix, uri] of state.additionalNamespaces) {
    if (state.masterNamespaces.has(prefix)) continue;
    if (new RegExp(`\\sxmlns:${escapeRegExp(prefix)}=`).test(rootTag)) continue;
    rootTag = rootTag.replace(/>$/, ` xmlns:${prefix}="${escapeXmlAttr(uri)}">`);
  }

  const ignorable = new Set<string>([
    ...state.masterIgnorablePrefixes,
    ...state.additionalIgnorablePrefixes,
  ]);
  const ignorableValue = Array.from(ignorable).join(' ').trim();
  if (ignorableValue) {
    if (/mc:Ignorable="[^"]*"/.test(rootTag)) {
      rootTag = rootTag.replace(
        /mc:Ignorable="[^"]*"/,
        `mc:Ignorable="${escapeXmlAttr(ignorableValue)}"`
      );
    } else {
      rootTag = rootTag.replace(/>$/, ` mc:Ignorable="${escapeXmlAttr(ignorableValue)}">`);
    }
  }

  return documentXml.replace(rootTagMatch[0], rootTag);
}

function parseRelationships(xml: string): RelationshipState {
  const entries: RelationshipEntry[] = [];
  const entryById = new Map<string, RelationshipEntry>();
  const usedIds = new Set<string>();

  const relRegex = /<Relationship\b([^>]*?)\/>/g;
  let relMatch: RegExpExecArray | null;

  while ((relMatch = relRegex.exec(xml)) != null) {
    const attrs = relMatch[1] ?? '';
    const attrRegex = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
    const map = new Map<string, string>();
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrs)) != null) {
      map.set(attrMatch[1], attrMatch[2]);
    }

    const id = map.get('Id');
    const type = map.get('Type');
    const target = map.get('Target');
    if (!id || !type || !target) continue;

    const entry: RelationshipEntry = {
      id,
      type,
      target,
      targetMode: map.get('TargetMode'),
    };
    entries.push(entry);
    entryById.set(id, entry);
    usedIds.add(id);
  }

  let nextSyntheticId = 1;
  while (usedIds.has(`rIdinc${nextSyntheticId}`)) {
    nextSyntheticId += 1;
  }

  return { entries, entryById, usedIds, nextSyntheticId };
}

function serializeRelationships(state: RelationshipState): string {
  const rows = state.entries.map((entry) => {
    const targetMode = entry.targetMode ? ` TargetMode="${escapeXmlAttr(entry.targetMode)}"` : '';
    return `<Relationship Id="${escapeXmlAttr(entry.id)}" Type="${escapeXmlAttr(entry.type)}" Target="${escapeXmlAttr(entry.target)}"${targetMode}/>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.join('')}</Relationships>`;
}

function allocateRelationshipId(state: RelationshipState): string {
  let candidate = `rIdinc${state.nextSyntheticId}`;
  while (state.usedIds.has(candidate)) {
    state.nextSyntheticId += 1;
    candidate = `rIdinc${state.nextSyntheticId}`;
  }
  state.nextSyntheticId += 1;
  state.usedIds.add(candidate);
  return candidate;
}

function addRelationship(state: RelationshipState, entry: RelationshipEntry): void {
  state.entries.push(entry);
  state.entryById.set(entry.id, entry);
  state.usedIds.add(entry.id);
}

function maxNumericAttribute(xml: string, regex: RegExp): number {
  let max = 0;
  let match: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((match = regex.exec(xml)) != null) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
}

function collectReferencedRelationshipIds(xml: string): string[] {
  const ids = new Set<string>();
  const regex = /\br:(?:id|embed|link)="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) != null) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
}

function normalizeWordPartPath(target: string): string | null {
  const clean = safeText(target).split('#')[0].split('?')[0].trim();
  if (!clean) return null;
  const normalized = pathPosix.normalize(pathPosix.join('word', clean));
  if (!normalized.startsWith('word/')) return null;
  return normalized;
}

async function readZipPartBuffer(zip: JSZip, partPath: string): Promise<Buffer | null> {
  const file = zip.file(partPath);
  if (!file) return null;
  const data = await file.async('nodebuffer');
  return Buffer.from(data);
}

function getPartRelationshipsPath(partPath: string): string {
  const dir = pathPosix.dirname(partPath);
  const base = pathPosix.basename(partPath);
  return pathPosix.join(dir, '_rels', `${base}.rels`);
}

function resolveRelationshipTargetPath(partPath: string, target: string): string | null {
  const cleanTarget = safeText(target).split('#')[0].split('?')[0].trim();
  if (!cleanTarget) return null;

  const baseDir = pathPosix.dirname(partPath);
  const normalized = pathPosix.normalize(pathPosix.join(baseDir, cleanTarget));
  if (!normalized.startsWith('word/')) return null;
  return normalized;
}

function extractTemplateImageMarkerPath(value: string | undefined): string | null {
  if (!value) return null;
  const unescaped = unescapeXmlAttr(value).trim();
  const markerMatch = /^\{\{\s*([^}]+?)\s*\}\}$/u.exec(unescaped);
  if (!markerMatch) return null;

  const token = markerMatch[1].trim();
  if (!token || token.startsWith('FOR ') || token.startsWith('END-FOR ') || token.startsWith('INCLUDE ')) {
    return null;
  }

  return token.startsWith('$') ? token.slice(1) : token;
}

function findEmbedRelationshipIdAtDocPr(xml: string, docPrIndex: number): string | null {
  const inlineStart = xml.lastIndexOf('<wp:inline', docPrIndex);
  const anchorStart = xml.lastIndexOf('<wp:anchor', docPrIndex);

  let containerStart = -1;
  let containerEndTag = '';
  if (inlineStart > anchorStart) {
    containerStart = inlineStart;
    containerEndTag = '</wp:inline>';
  } else if (anchorStart >= 0) {
    containerStart = anchorStart;
    containerEndTag = '</wp:anchor>';
  }

  if (containerStart < 0) return null;

  const containerEnd = xml.indexOf(containerEndTag, docPrIndex);
  if (containerEnd < 0) return null;

  const containerXml = xml.slice(containerStart, containerEnd + containerEndTag.length);
  const embedMatch = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(containerXml);
  if (embedMatch?.[1]) return embedMatch[1];
  const linkMatch = /<a:blip\b[^>]*\br:link="([^"]+)"/.exec(containerXml);
  return linkMatch?.[1] ?? null;
}

async function copyTargetPartToMaster(
  target: string,
  includeZip: JSZip,
  state: LoopExpansionState,
  includeInstanceId: number
): Promise<string> {
  const sourcePartPath = normalizeWordPartPath(target);
  if (!sourcePartPath) return target;

  const sourceBuffer = await readZipPartBuffer(includeZip, sourcePartPath);
  if (!sourceBuffer) return target;

  const baseRelative = sourcePartPath.slice('word/'.length);
  let candidateRelative = baseRelative;
  let attempt = 1;

  while (attempt < 10000) {
    const candidatePartPath = normalizeWordPartPath(candidateRelative);
    if (!candidatePartPath) return target;

    const existing = await readZipPartBuffer(state.masterZip, candidatePartPath);
    if (!existing) {
      state.masterZip.file(candidatePartPath, sourceBuffer);
      return candidateRelative;
    }

    if (Buffer.compare(existing, sourceBuffer) === 0) {
      return candidateRelative;
    }

    const dir = pathPosix.dirname(baseRelative);
    const ext = pathPosix.extname(baseRelative);
    const stem = pathPosix.basename(baseRelative, ext);
    candidateRelative = pathPosix.join(
      dir === '.' ? '' : dir,
      `${stem}-inc-${includeInstanceId}-${attempt}${ext}`
    );
    attempt += 1;
  }

  return target;
}

function remapDocPrIds(xml: string, state: LoopExpansionState): string {
  return xml.replace(/(<wp:docPr\b[^>]*\bid=")(\d+)(")/g, (_match, start: string, _id: string, end: string) => {
    const next = state.nextDocPrId++;
    return `${start}${next}${end}`;
  });
}

function remapBookmarkIds(xml: string, state: LoopExpansionState): string {
  const idMap = new Map<string, string>();
  return xml.replace(
    /(<w:(?:bookmarkStart|bookmarkEnd)\b[^>]*\bw:id=")(\d+)(")/g,
    (_match, start: string, oldId: string, end: string) => {
      let mapped = idMap.get(oldId);
      if (!mapped) {
        mapped = String(state.nextBookmarkId++);
        idMap.set(oldId, mapped);
      }
      return `${start}${mapped}${end}`;
    }
  );
}

function registerRootNamespaces(state: LoopExpansionState, includeRootInfo: RootInfo): void {
  for (const [prefix, uri] of includeRootInfo.namespaces) {
    if (state.masterNamespaces.has(prefix)) continue;
    state.additionalNamespaces.set(prefix, uri);
  }

  for (const prefix of includeRootInfo.ignorablePrefixes) {
    if (state.masterIgnorablePrefixes.has(prefix)) continue;
    state.additionalIgnorablePrefixes.add(prefix);
  }
}

async function remapIncludeRelationships(
  bodyXml: string,
  includeRelationships: RelationshipState,
  includeZip: JSZip,
  state: LoopExpansionState,
  includeInstanceId: number,
  requestId?: string
): Promise<string> {
  const referencedIds = collectReferencedRelationshipIds(bodyXml);
  if (referencedIds.length === 0) return bodyXml;

  const idMap = new Map<string, string>();

  for (const sourceId of referencedIds) {
    const sourceRel = includeRelationships.entryById.get(sourceId);
    if (!sourceRel) {
      logDocx(`include relation not found: ${sourceId}`, requestId);
      continue;
    }

    let target = sourceRel.target;
    const isExternal = sourceRel.targetMode?.toLowerCase() === 'external';
    if (!isExternal) {
      target = await copyTargetPartToMaster(target, includeZip, state, includeInstanceId);
    }

    const newId = allocateRelationshipId(state.masterRelationships);
    addRelationship(state.masterRelationships, {
      id: newId,
      type: sourceRel.type,
      target,
      targetMode: sourceRel.targetMode,
    });
    idMap.set(sourceId, newId);
  }

  if (idMap.size === 0) return bodyXml;

  return bodyXml.replace(/\br:(id|embed|link)="([^"]+)"/g, (match, attr: string, id: string) => {
    const mapped = idMap.get(id);
    return mapped ? `r:${attr}="${mapped}"` : match;
  });
}

function extractBodyXml(documentXml: string): string {
  const bodyMatch = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) {
    throw new Error('Invalid DOCX template: <w:body> not found in word/document.xml');
  }

  const bodyXml = bodyMatch[1];
  return bodyXml
    .replace(/\s*<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/u, '')
    .replace(/\s*<w:sectPr\b[^>]*\/>\s*$/u, '');
}

async function loadTemplateBodyXml(templateFileName: string): Promise<string> {
  const templatePath = resolve(TEMPLATES_DIR, templateFileName);
  const templateBuffer = await readFile(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);
  const docXmlFile = zip.file('word/document.xml');

  if (!docXmlFile) {
    throw new Error(`Invalid DOCX template: word/document.xml not found in ${templateFileName}`);
  }

  const xml = await docXmlFile.async('string');
  return extractBodyXml(xml);
}

function prefixIncludeExpr(expr: string, includeVar: string): string {
  const leftPart = expr.split('||')[0]?.trim() ?? expr.trim();
  if (!leftPart || leftPart.startsWith('$')) {
    return expr;
  }

  const pattern = new RegExp(`\\b${escapeRegExp(leftPart)}\\b`);
  return expr.replace(pattern, `$${includeVar}.${leftPart}`);
}

function remapIncludedTemplatePlaceholders(xml: string, includeVar: string): string {
  const withPrefixedLoops = xml.replace(
    /{{\s*FOR\s+([A-Za-z_]\w*)\s+IN\s+\(([^)]+)\)\s*}}/g,
    (_match, loopVar: string, loopExpr: string) => {
      const prefixedExpr = prefixIncludeExpr(loopExpr, includeVar);
      return `{{FOR ${loopVar} IN (${prefixedExpr})}}`;
    }
  );

  return withPrefixedLoops.replace(/{{\s*([^}]+?)\s*}}/g, (match, tokenRaw: string) => {
    const token = tokenRaw.trim();
    if (
      token.startsWith('FOR ') ||
      token.startsWith('END-FOR ') ||
      token.startsWith('INCLUDE ') ||
      token.startsWith('$')
    ) {
      return match;
    }
    return `{{$${includeVar}.${token}}}`;
  });
}

async function expandIncludes(
  xml: string,
  scope: Record<string, unknown>,
  state: LoopExpansionState
): Promise<string> {
  const includeRegex = /{{\s*INCLUDE\s+([A-Za-z0-9._/-]+)\s+WITH\s+\(([^)]+)\)\s*}}/g;
  const matches = [...xml.matchAll(includeRegex)];
  if (matches.length === 0) return xml;

  let nextXml = xml;

  for (const match of matches) {
    const full = match[0];
    const templateRef = normalizeIncludeTemplateRef(match[1] ?? '');
    const includeExpr = safeText(match[2]).trim();
    const includeInstanceId = state.includeCounter++;
    if (!templateRef) continue;

    const includeContext = resolveExpression(scope, includeExpr);
    if (includeContext === undefined || includeContext === null) {
      nextXml = nextXml.replace(full, '');
      continue;
    }

    if (templateRef === 'usecase-onepage.docx') {
      const renderedIncludedBody = await renderIncludedUseCaseBodyXml(
        includeContext,
        state,
        includeInstanceId,
        state.requestId
      );
      nextXml = nextXml.replace(full, renderedIncludedBody);
      continue;
    }

    let includeBody = state.includeTemplateXmlCache.get(templateRef);
    if (!includeBody) {
      includeBody = await loadTemplateBodyXml(templateRef);
      state.includeTemplateXmlCache.set(templateRef, includeBody);
    }

    const includeVar = `__include_${includeInstanceId}`;
    const includeScope: Record<string, unknown> = {
      ...scope,
      [includeVar]: includeContext,
    };

    const remappedIncludeBody = remapIncludedTemplatePlaceholders(includeBody, includeVar);
    const expandedIncluded = await expandLoops(remappedIncludeBody, includeScope, state);
    nextXml = nextXml.replace(full, expandedIncluded);
  }

  return nextXml;
}

async function renderIncludedUseCaseBodyXml(
  includeContext: unknown,
  state: LoopExpansionState,
  includeInstanceId: number,
  requestId?: string
): Promise<string> {
  if (!includeContext || typeof includeContext !== 'object') return '';

  const startedAt = Date.now();
  const context = includeContext as Record<string, unknown>;
  const templateData = includeContext as TemplateData;
  const renderedDocx = await renderDocxTemplate(
    'usecase-onepage.docx',
    context,
    basePayloads(templateData),
    requestId
  );

  const zip = await JSZip.loadAsync(renderedDocx);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) return '';
  const relsFile = zip.file('word/_rels/document.xml.rels');
  const xml = await docXmlFile.async('string');
  const relsXml = relsFile ? await relsFile.async('string') : EMPTY_RELATIONSHIPS_XML;
  const includeRootInfo = parseRootInfo(xml);
  registerRootNamespaces(state, includeRootInfo);
  const includeRelationships = parseRelationships(relsXml);

  let bodyXml = extractBodyXml(xml);
  bodyXml = await remapIncludeRelationships(
    bodyXml,
    includeRelationships,
    zip,
    state,
    includeInstanceId,
    requestId
  );
  bodyXml = remapDocPrIds(bodyXml, state);
  bodyXml = remapBookmarkIds(bodyXml, state);

  logDocx(
    `include rendered template="usecase-onepage.docx" in ${Date.now() - startedAt}ms`,
    requestId
  );
  return bodyXml;
}

function findNextLoop(xml: string, fromIndex = 0): LoopMatch | null {
  const startRegex = /{{\s*FOR\s+([A-Za-z_]\w*)\s+IN\s+\(([^)]+)\)\s*}}/g;
  startRegex.lastIndex = fromIndex;
  const start = startRegex.exec(xml);
  if (!start) return null;

  const markerRegex = /{{\s*(FOR\s+[A-Za-z_]\w*\s+IN\s+\([^)]+\)|END-FOR\s+[A-Za-z_]\w*)\s*}}/g;
  markerRegex.lastIndex = start.index + start[0].length;

  let depth = 1;
  let end: RegExpExecArray | null = null;
  let marker: RegExpExecArray | null;

  while ((marker = markerRegex.exec(xml)) != null) {
    if (marker[1].startsWith('FOR ')) {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        end = marker;
        break;
      }
    }
  }

  if (!end) return null;

  return {
    startIndex: start.index,
    startToken: start[0],
    loopVar: start[1],
    loopExpr: start[2],
    endIndex: end.index,
    endToken: end[0],
  };
}

function findEnclosingParagraph(xml: string, tokenIndex: number): XmlRange | null {
  const startWithAttrs = xml.lastIndexOf('<w:p ', tokenIndex);
  const startBare = xml.lastIndexOf('<w:p>', tokenIndex);
  const start = Math.max(startWithAttrs, startBare);
  if (start < 0) return null;

  const endTagIndex = xml.indexOf('</w:p>', tokenIndex);
  if (endTagIndex < 0) return null;

  return {
    start,
    end: endTagIndex + '</w:p>'.length,
  };
}

function isControlOnlyParagraph(paragraphXml: string, controlToken: string): boolean {
  const withoutToken = paragraphXml.replace(controlToken, '');
  const plain = withoutToken
    .replace(/<[^>]+>/g, '')
    .replace(/[\s\u00A0]+/g, '')
    .trim();
  return plain.length === 0;
}

const INCLUDE_TOKEN_REGEX = /{{\s*INCLUDE\s+[A-Za-z0-9._/-]+\s+WITH\s+\([^)]+\)\s*}}/g;

function extractIncludeTokens(xml: string): string[] {
  return [...xml.matchAll(INCLUDE_TOKEN_REGEX)].map((match) => match[0]);
}

function isIncludeOnlyLoopParagraph(paragraphXml: string): boolean {
  const withoutMarkers = paragraphXml
    .replace(/{{\s*FOR\s+[A-Za-z_]\w*\s+IN\s+\([^)]+\)\s*}}/g, '')
    .replace(/{{\s*END-FOR\s+[A-Za-z_]\w*\s*}}/g, '')
    .replace(INCLUDE_TOKEN_REGEX, '');

  const plain = withoutMarkers
    .replace(/<w:br\b[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\s\u00A0]+/g, '')
    .trim();

  return plain.length === 0 && extractIncludeTokens(paragraphXml).length > 0;
}

function paragraphHasPageBreakBefore(paragraphXml: string): boolean {
  return /<w:pageBreakBefore\b[^>]*(?:\/>|>[\s\S]*?<\/w:pageBreakBefore>)/.test(paragraphXml);
}

function paragraphHasSectionProperties(paragraphXml: string): boolean {
  return /<w:sectPr\b/.test(paragraphXml);
}

function isVisuallyEmptyParagraph(paragraphXml: string): boolean {
  const withoutLoopMarkers = paragraphXml.replace(
    /{{\s*(FOR\s+[A-Za-z_]\w*\s+IN\s+\([^)]+\)|END-FOR\s+[A-Za-z_]\w*)\s*}}/g,
    ''
  );

  const plain = withoutLoopMarkers
    .replace(/<w:tab\/>/g, '')
    .replace(/<w:br\b[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\s\u00A0]+/g, '')
    .trim();

  return plain.length === 0;
}

function stripEmptyParagraphsBeforeTables(xml: string): string {
  return xml.replace(/(<w:p\b[\s\S]*?<\/w:p>)(\s*)(?=<w:tbl\b)/g, (match, paragraphXml: string) =>
    isVisuallyEmptyParagraph(paragraphXml) ? '' : match
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readAttr(fragment: string, attr: string): string | undefined {
  const doubleQuoted = fragment.match(new RegExp(`${escapeRegExp(attr)}="([^"]+)"`));
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = fragment.match(new RegExp(`${escapeRegExp(attr)}='([^']+)'`));
  return singleQuoted?.[1];
}

function hasEnabledRprFlag(rprXml: string, tag: string): boolean | undefined {
  const match = rprXml.match(new RegExp(`<w:${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</w:${tag}>)`));
  if (!match) return undefined;
  const val = readAttr(match[0], 'w:val');
  if (!val) return true;
  const lowered = val.toLowerCase();
  return !(lowered === '0' || lowered === 'false' || lowered === 'off');
}

function parseBaseRunStyleFromRunXml(runXml: string): BaseRunStyle {
  const rprMatch = runXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/);
  if (!rprMatch) return {};

  const rpr = rprMatch[0];
  const style: BaseRunStyle = {};

  const rStyleMatch = rpr.match(/<w:rStyle\b[^>]*\/>/);
  if (rStyleMatch) {
    style.style = readAttr(rStyleMatch[0], 'w:val');
  }

  const rFontsMatch = rpr.match(/<w:rFonts\b[^>]*\/>/);
  if (rFontsMatch) {
    style.font =
      readAttr(rFontsMatch[0], 'w:ascii') ??
      readAttr(rFontsMatch[0], 'w:hAnsi') ??
      readAttr(rFontsMatch[0], 'w:cs');
  }

  const sizeMatch = rpr.match(/<w:sz\b[^>]*\/>/);
  if (sizeMatch) {
    const sizeVal = readAttr(sizeMatch[0], 'w:val');
    if (sizeVal) {
      const parsed = Number(sizeVal);
      if (!Number.isNaN(parsed)) style.size = parsed;
    }
  }

  const colorMatch = rpr.match(/<w:color\b[^>]*\/>/);
  if (colorMatch) {
    const colorVal = readAttr(colorMatch[0], 'w:val');
    if (colorVal && colorVal.toLowerCase() !== 'auto') {
      style.color = colorVal;
    }
  }

  const bold = hasEnabledRprFlag(rpr, 'b');
  if (bold !== undefined) style.bold = bold;

  const italic = hasEnabledRprFlag(rpr, 'i');
  if (italic !== undefined) style.italic = italic;

  const strike = hasEnabledRprFlag(rpr, 'strike');
  if (strike !== undefined) style.strike = strike;

  return style;
}

function isControlPlaceholder(placeholder: string): boolean {
  return (
    placeholder.startsWith('FOR ') ||
    placeholder.startsWith('END-FOR ') ||
    placeholder.startsWith('INCLUDE ') ||
    placeholder.startsWith('$')
  );
}

function unwrapPlaceholderContentControls(xml: string): { xml: string; unwrappedCount: number } {
  if (!xml.includes('<w:sdt') || !xml.includes('{{')) {
    return { xml, unwrappedCount: 0 };
  }

  const sdtRegex = /<w:sdt\b[\s\S]*?<\/w:sdt>/g;
  let currentXml = xml;
  let unwrappedCount = 0;
  let changed = true;

  while (changed) {
    changed = false;
    currentXml = currentXml.replace(sdtRegex, (sdtBlock) => {
      if (!sdtBlock.includes('{{')) return sdtBlock;

      const contentMatch = sdtBlock.match(/<w:sdtContent\b[^>]*>([\s\S]*?)<\/w:sdtContent>/);
      if (!contentMatch) return sdtBlock;

      changed = true;
      unwrappedCount += 1;
      return contentMatch[1];
    });
  }

  return { xml: currentXml, unwrappedCount };
}

async function assertNoUnresolvedPatchInstances(renderedDocx: Buffer, requestId?: string): Promise<void> {
  const zip = await JSZip.loadAsync(renderedDocx);
  const unresolved: Array<{ fileName: string; count: number; sample: string[] }> = [];
  const unresolvedRegex = /{{\s*__phinst_[^}]+\s*}}/g;

  const wordXmlParts = Object.keys(zip.files)
    .filter((fileName) => fileName.startsWith('word/') && fileName.endsWith('.xml'))
    .sort();

  for (const fileName of wordXmlParts) {
    const file = zip.file(fileName);
    if (!file) continue;
    const xml = await file.async('string');
    const tokens = [...xml.matchAll(unresolvedRegex)].map((match) => match[0]);
    const count = tokens.length;
    if (count > 0) {
      unresolved.push({ fileName, count, sample: tokens.slice(0, 5) });
    }
  }

  if (unresolved.length === 0) return;

  const details = unresolved
    .map((item) => `${item.fileName}:${item.count}:${item.sample.join('|')}`)
    .join(', ');
  logDocx(`unresolved patch placeholders detected (${details})`, requestId);
  throw new Error(`docx_patch_incomplete:${details}`);
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fallbackTextFromPayload(payload: PatchPayload): string {
  if (payload.value == null) return '';
  if (Array.isArray(payload.value) || typeof payload.value === 'object') return '';
  return safeText(payload.value);
}

async function replaceUnresolvedPatchInstances(
  renderedDocx: Buffer,
  allInstances: Record<string, PlaceholderInstance>,
  context: Record<string, unknown>,
  payloads: Record<string, PatchPayload>,
  requestId?: string
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(renderedDocx);
  const unresolvedRegex = /{{\s*(__phinst_[^}\s]+)\s*}}/g;
  let replacedCount = 0;

  const wordXmlParts = Object.keys(zip.files)
    .filter((fileName) => fileName.startsWith('word/') && fileName.endsWith('.xml'))
    .sort();

  for (const fileName of wordXmlParts) {
    const file = zip.file(fileName);
    if (!file) continue;
    const xml = await file.async('string');
    if (!xml.includes('__phinst_')) continue;

    let fileReplaced = 0;
    const replacedXml = xml.replace(unresolvedRegex, (_match, tokenKeyRaw: string) => {
      const tokenKey = tokenKeyRaw.trim();
      const instance = allInstances[tokenKey];
      if (!instance) return '';
      const payload = placeholderToPayload(instance.sourcePlaceholder, context, payloads);
      const value = escapeXmlText(fallbackTextFromPayload(payload));
      fileReplaced += 1;
      return value;
    });

    if (fileReplaced > 0) {
      zip.file(fileName, replacedXml);
      replacedCount += fileReplaced;
    }
  }

  if (replacedCount > 0) {
    logDocx(`fallback replaced unresolved placeholders count=${replacedCount}`, requestId);
  }

  const updated = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(updated);
}

async function enableUpdateFieldsOnOpen(renderedDocx: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(renderedDocx);
  const docFile = zip.file('word/document.xml');
  const settingsFile = zip.file('word/settings.xml');

  if (docFile) {
    let docXml = await docFile.async('string');
    docXml = docXml.replace(
      /<w:instrText\b[^>]*>\s*TOC[\s\S]*?<\/w:instrText>/g,
      '<w:instrText xml:space="preserve"> TOC \\o "1-9" \\h \\z \\u </w:instrText>'
    );
    docXml = docXml.replace(
      /<w:fldChar\b([^>]*\bw:fldCharType="begin"[^>]*?)(\/?)>/g,
      (_match, attrsRaw: string, selfClosing: string) => {
        let attrs = attrsRaw;
        if (/\bw:dirty=/.test(attrs)) {
          attrs = attrs.replace(/\bw:dirty="[^"]*"/g, 'w:dirty="true"');
        } else {
          attrs = `${attrs} w:dirty="true"`;
        }
        if (/\bw:fldLock=/.test(attrs)) {
          attrs = attrs.replace(/\bw:fldLock="[^"]*"/g, 'w:fldLock="false"');
        } else {
          attrs = `${attrs} w:fldLock="false"`;
        }
        return `<w:fldChar${attrs}${selfClosing}>`;
      }
    );
    zip.file('word/document.xml', docXml);
  }

  if (!settingsFile) {
    const updated = await zip.generateAsync({ type: 'nodebuffer' });
    return Buffer.from(updated);
  }

  let settingsXml = await settingsFile.async('string');
  const hasUpdateFields = /<w:updateFields\b/.test(settingsXml);

  if (hasUpdateFields) {
    settingsXml = settingsXml.replace(
      /<w:updateFields\b[^>]*(?:\/>|>[\s\S]*?<\/w:updateFields>)/,
      '<w:updateFields w:val="true"/>'
    );
  } else {
    settingsXml = settingsXml.replace(
      '</w:settings>',
      '<w:updateFields w:val="true"/></w:settings>'
    );
  }

  zip.file('word/settings.xml', settingsXml);
  const updated = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(updated);
}

async function replaceTemplateImagePlaceholders(
  renderedDocx: Buffer,
  context: Record<string, unknown>,
  requestId?: string
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(renderedDocx);
  const imageCache = new Map<string, Promise<ImagePatchValue | null>>();
  let replacements = 0;

  const wordXmlParts = Object.keys(zip.files)
    .filter(
      (fileName) =>
        fileName.startsWith('word/') &&
        fileName.endsWith('.xml') &&
        !fileName.includes('/_rels/')
    )
    .sort();

  for (const partPath of wordXmlParts) {
    const partFile = zip.file(partPath);
    if (!partFile) continue;

    const xml = await partFile.async('string');
    if (!xml.includes('<wp:docPr') || !xml.includes('{{')) continue;

    const relsPath = getPartRelationshipsPath(partPath);
    const relsFile = zip.file(relsPath);
    if (!relsFile) continue;
    const relationships = parseRelationships(await relsFile.async('string'));

    const docPrRegex = /<wp:docPr\b([^>]*?)(?:\/>|>)/g;
    let docPrMatch: RegExpExecArray | null;
    while ((docPrMatch = docPrRegex.exec(xml)) != null) {
      const attributes = parseXmlAttributes(docPrMatch[1] ?? '');
      const markerPath =
        extractTemplateImageMarkerPath(attributes.get('descr')) ??
        extractTemplateImageMarkerPath(attributes.get('title'));
      if (!markerPath) continue;

      const embedId = findEmbedRelationshipIdAtDocPr(xml, docPrMatch.index);
      if (!embedId) continue;

      const relationship = relationships.entryById.get(embedId);
      if (!relationship || safeText(relationship.targetMode).toLowerCase() === 'external') continue;

      const targetPath = resolveRelationshipTargetPath(partPath, relationship.target);
      if (!targetPath) continue;

      const markerValue = resolvePath(context, markerPath);
      if (markerValue == null) continue;

      let imagePromise = imageCache.get(markerPath);
      if (!imagePromise) {
        imagePromise = resolveImagePatchValueFromUnknown(
          markerValue,
          requestId,
          `template image "${markerPath}"`
        );
        imageCache.set(markerPath, imagePromise);
      }

      const image = await imagePromise;
      if (!image) continue;

      zip.file(targetPath, image.data);
      replacements += 1;
    }
  }

  if (replacements === 0) return renderedDocx;

  logDocx(`template image placeholders replaced count=${replacements}`, requestId);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

function rewritePlaceholderInstances(xml: string, keyPrefix = ''): {
  rewrittenXml: string;
  instances: Record<string, PlaceholderInstance>;
} {
  const instances: Record<string, PlaceholderInstance> = {};
  let counter = 0;

  const runRegex = /<w:r\b[\s\S]*?<\/w:r>/g;
  let rewritten = '';
  let lastIndex = 0;
  let runMatch: RegExpExecArray | null;

  while ((runMatch = runRegex.exec(xml)) != null) {
    rewritten += xml.slice(lastIndex, runMatch.index);

    const runXml = runMatch[0];
    const baseStyle = parseBaseRunStyleFromRunXml(runXml);
    const rewrittenRunXml = runXml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, (textNodeXml) =>
      textNodeXml.replace(/{{\s*([^}]+?)\s*}}/g, (match, placeholderRaw: string) => {
        const placeholder = placeholderRaw.trim();
        if (isControlPlaceholder(placeholder)) return match;
        const instanceKey = `__phinst_${keyPrefix}${counter++}`;
        instances[instanceKey] = {
          sourcePlaceholder: placeholder,
          baseStyle: { ...baseStyle },
        };
        return `{{${instanceKey}}}`;
      })
    );

    rewritten += rewrittenRunXml;
    lastIndex = runRegex.lastIndex;
  }

  rewritten += xml.slice(lastIndex);
  return {
    rewrittenXml: rewritten,
    instances,
  };
}

function inferPatchModeForPath(path: string, value: unknown): PatchMode {
  const field = path.split('.').pop()?.trim() ?? '';
  if (
    field === 'score' ||
    field === 'stars' ||
    field === 'crosses' ||
    field.endsWith('Score') ||
    field.endsWith('Stars') ||
    field.endsWith('Crosses')
  ) {
    return 'plain';
  }

  if (field === 'url') return 'markdown_inline';
  if (MARKDOWN_BLOCK_FIELDS.has(field)) return 'markdown_block';

  if (typeof value === 'number' || typeof value === 'boolean') return 'plain';
  if (typeof value === 'string') return 'markdown_inline';
  return 'plain';
}

function makeScopedPatchKey(path: string, counter: number): string {
  const field = path.replace(/[^a-zA-Z0-9_]/g, '_');
  return `__loop_${field}_${counter}`;
}

function clampStarsLevel(stars: number): number {
  if (!Number.isFinite(stars)) return 1;
  const rounded = Math.round(stars);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded;
}

function renderStarGauge(score: number): string {
  const filled = clampStarsLevel(fibonacciToStars(Number(score)));
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`;
}

function renderCrossGauge(score: number): string {
  const filled = clampStarsLevel(fibonacciToStars(Number(score)));
  return `${'✕'.repeat(filled)}${'—'.repeat(5 - filled)}`;
}

function replaceScopedValuePlaceholders(
  xml: string,
  scope: Record<string, unknown>,
  state: LoopExpansionState
): string {
  const regex = /{{\s*\$([A-Za-z_]\w*(?:\.[A-Za-z0-9_]+)*)\s*}}/g;

  return xml.replace(regex, (_match, scopedPathRaw: string) => {
    const scopedPath = scopedPathRaw.trim();
    const resolved = resolvePath(scope, scopedPath);
    const key = makeScopedPatchKey(scopedPath, state.counter++);

    state.loopPatches[key] = {
      mode: inferPatchModeForPath(scopedPath, resolved),
      value: resolved,
    };

    return `{{${key}}}`;
  });
}

async function expandLoops(
  xml: string,
  scope: Record<string, unknown>,
  state: LoopExpansionState
): Promise<string> {
  let currentXml = xml;
  let cursor = 0;
  let hasPendingLoop = true;

  while (hasPendingLoop) {
    const loop = findNextLoop(currentXml, cursor);
    if (!loop) {
      hasPendingLoop = false;
      continue;
    }

    const loopStartTokenStart = loop.startIndex;
    const loopStartTokenEnd = loop.startIndex + loop.startToken.length;
    const loopEndTokenStart = loop.endIndex;
    const loopEndTokenEnd = loop.endIndex + loop.endToken.length;

    const startParagraph = findEnclosingParagraph(currentXml, loop.startIndex);
    const endParagraph = findEnclosingParagraph(currentXml, loop.endIndex);
    const isSameControlParagraph =
      startParagraph != null &&
      endParagraph != null &&
      startParagraph.start === endParagraph.start &&
      startParagraph.end === endParagraph.end;
    const sameParagraphXml =
      isSameControlParagraph && startParagraph
        ? currentXml.slice(startParagraph.start, startParagraph.end)
        : '';
    const isIncludeOnlySameParagraphLoop =
      isSameControlParagraph &&
      sameParagraphXml.length > 0 &&
      isIncludeOnlyLoopParagraph(sameParagraphXml);
    const includeOnlyParagraphHasPageBreakBefore =
      isIncludeOnlySameParagraphLoop && paragraphHasPageBreakBefore(sameParagraphXml);
    const includeTokensForSameParagraphLoop = isIncludeOnlySameParagraphLoop
      ? extractIncludeTokens(sameParagraphXml)
      : [];
    const hasControlOnlyParagraphs =
      startParagraph != null &&
      endParagraph != null &&
      startParagraph.end <= endParagraph.start &&
      isControlOnlyParagraph(
        currentXml.slice(startParagraph.start, startParagraph.end),
        loop.startToken
      ) &&
      isControlOnlyParagraph(
        currentXml.slice(endParagraph.start, endParagraph.end),
        loop.endToken
      );
    const startControlParagraphXml = startParagraph
      ? currentXml.slice(startParagraph.start, startParagraph.end)
      : '';
    const endControlParagraphXml = endParagraph
      ? currentXml.slice(endParagraph.start, endParagraph.end)
      : '';
    const startControlHasSectPr =
      startControlParagraphXml.length > 0 && paragraphHasSectionProperties(startControlParagraphXml);
    const endControlHasSectPr =
      endControlParagraphXml.length > 0 && paragraphHasSectionProperties(endControlParagraphXml);

    const bodyBetweenControlParagraphs =
      hasControlOnlyParagraphs && startParagraph && endParagraph
        ? currentXml.slice(startParagraph.end, endParagraph.start)
        : '';

    const hasTableInLoopBody = /<w:tbl[\s>]/.test(bodyBetweenControlParagraphs);
    const canDropBothControlParagraphs =
      hasControlOnlyParagraphs &&
      !hasTableInLoopBody &&
      !startControlHasSectPr &&
      !endControlHasSectPr;
    const canDropOnlyStartControlParagraph =
      hasControlOnlyParagraphs &&
      !startControlHasSectPr &&
      (hasTableInLoopBody || endControlHasSectPr);

    const innerTemplate = canDropBothControlParagraphs
      ? bodyBetweenControlParagraphs
      : canDropOnlyStartControlParagraph && startParagraph && endParagraph
        ? currentXml.slice(startParagraph.end, endParagraph.start)
        : currentXml.slice(loopStartTokenEnd, loopEndTokenStart);
    const loopPath = loopExprToPath(loop.loopExpr);
    const itemsRaw = resolveExpression(scope, loop.loopExpr) ?? resolvePath(scope, loopPath);
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];

    const renderedPieces: string[] = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (loop.loopVar === 'uc') {
        if (state.onAnnexProgress) {
          await state.onAnnexProgress(index + 1, items.length);
        }
        logDocx(`annex usecase ${index + 1}/${items.length}`, state.requestId);
      }
      const nestedScope: Record<string, unknown> = {
        ...scope,
        [loop.loopVar]: item,
      };

      if (isIncludeOnlySameParagraphLoop) {
        const includeChunks: string[] = [];
        for (const includeToken of includeTokensForSameParagraphLoop) {
          let expandedInclude = await expandIncludes(includeToken, nestedScope, state);
          expandedInclude = replaceScopedValuePlaceholders(expandedInclude, nestedScope, state);
          includeChunks.push(expandedInclude);
        }
        let renderedInclude = includeChunks.join('');
        if (includeOnlyParagraphHasPageBreakBefore) {
          renderedInclude = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>${renderedInclude}`;
        }
        renderedPieces.push(renderedInclude);
        continue;
      }

      let piece = await expandLoops(innerTemplate, nestedScope, state);
      piece = replaceScopedValuePlaceholders(piece, nestedScope, state);
      renderedPieces.push(piece);
    }
    const rendered = renderedPieces.join('');

    if (isIncludeOnlySameParagraphLoop && startParagraph) {
      currentXml =
        currentXml.slice(0, startParagraph.start) +
        rendered +
        currentXml.slice(startParagraph.end);

      cursor = startParagraph.start + rendered.length;
    } else if (canDropBothControlParagraphs && startParagraph && endParagraph) {
      currentXml =
        currentXml.slice(0, startParagraph.start) +
        rendered +
        currentXml.slice(endParagraph.end);

      cursor = startParagraph.start + rendered.length;
    } else if (canDropOnlyStartControlParagraph && startParagraph && endParagraph) {
      currentXml =
        currentXml.slice(0, startParagraph.start) +
        rendered +
        currentXml.slice(endParagraph.start);

      cursor = startParagraph.start + rendered.length;
    } else {
      currentXml =
        currentXml.slice(0, loopStartTokenStart) +
        rendered +
        currentXml.slice(loopEndTokenEnd);

      cursor = loopStartTokenStart + rendered.length;
    }
  }

  currentXml = await expandIncludes(currentXml, scope, state);
  return replaceScopedValuePlaceholders(currentXml, scope, state);
}

function buildAxes(
  axes: MatrixConfig['valueAxes'],
  scores: Array<{ axisId: string; rating: number; description?: string }> | undefined
): Array<{ title: string; score: number; stars: string; crosses: string; description: string }> {
  if (!axes || axes.length === 0) return [];

  const items = scores ?? [];

  return axes
    .map((axis) => {
      const score = items.find((entry) => entry.axisId === axis.id);
      if (!score) return null;

      return {
        title: safeText(axis.name),
        score: Number(score.rating),
        stars: renderStarGauge(Number(score.rating)),
        crosses: renderCrossGauge(Number(score.rating)),
        description: safeText(score.description),
      };
    })
    .filter(Boolean) as Array<{ title: string; score: number; stars: string; crosses: string; description: string }>;
}

function buildTemplateData(useCase: UseCase, matrix: MatrixConfig | null): TemplateData {
  const d = useCase.data;

  return {
    name: safeText(d.name),
    description: safeText(d.description),
    problem: safeText(d.problem),
    solution: safeText(d.solution),
    process: safeText(d.process),
    domain: safeText(d.domain),
    technologies: normalizeList(d.technologies),
    benefits: normalizeList(d.benefits),
    metrics: normalizeList(d.metrics),
    risks: normalizeList(d.risks),
    constraints: normalizeList(d.constraints),
    nextSteps: normalizeList(d.nextSteps),
    dataSources: normalizeList(d.dataSources),
    dataObjects: normalizeList(d.dataObjects),
    references: Array.isArray(d.references)
      ? d.references.map((ref) => ({
          title: safeText(ref.title),
          url: safeText(ref.url),
          link: toMarkdownLink(safeText(ref.title), safeText(ref.url)),
          excerpt: safeText(ref.excerpt),
        }))
      : [],
    valueAxes: buildAxes(matrix?.valueAxes ?? [], d.valueScores),
    complexityAxes: buildAxes(matrix?.complexityAxes ?? [], d.complexityScores),
    deadline: safeText(d.deadline),
    contact: safeText(d.contact),
    totalValueScore: useCase.totalValueScore ?? '',
    totalComplexityScore: useCase.totalComplexityScore ?? '',
    totalValueStars: renderStarGauge(Number(useCase.totalValueScore ?? 0)),
    totalComplexityStars: renderStarGauge(Number(useCase.totalComplexityScore ?? 0)),
    totalComplexityCrosses: renderCrossGauge(Number(useCase.totalComplexityScore ?? 0)),
  };
}

function basePayloads(data: TemplateData): Record<string, PatchPayload> {
  return {
    name: { mode: 'markdown_inline', value: data.name },
    description: { mode: 'markdown_block', value: data.description },
    problem: { mode: 'markdown_block', value: data.problem },
    solution: { mode: 'markdown_block', value: data.solution },
    deadline: { mode: 'markdown_inline', value: data.deadline },
    contact: { mode: 'markdown_inline', value: data.contact },
    totalValueScore: { mode: 'plain', value: data.totalValueScore },
    totalComplexityScore: { mode: 'plain', value: data.totalComplexityScore },
    totalValueStars: { mode: 'plain', value: data.totalValueStars },
    totalComplexityStars: { mode: 'plain', value: data.totalComplexityStars },
    totalComplexityCrosses: { mode: 'plain', value: data.totalComplexityCrosses },
  };
}

function placeholderToPayload(
  placeholder: string,
  context: Record<string, unknown>,
  payloads: Record<string, PatchPayload>
): PatchPayload {
  if (payloads[placeholder]) return payloads[placeholder];

  if (isControlPlaceholder(placeholder)) {
    return { mode: 'plain', value: '' };
  }

  const value = resolvePath(context, placeholder);
  if (value == null) return { mode: 'plain', value: '' };
  if (Array.isArray(value) || typeof value === 'object') return { mode: 'plain', value: '' };

  return {
    mode: inferPatchModeForPath(placeholder, value),
    value,
  };
}

async function expandTemplateLoops(
  template: Buffer,
  data: Record<string, unknown>,
  requestId?: string,
  callbacks?: RenderCallbacks
): Promise<{ template: Buffer; loopPatches: Record<string, PatchPayload>; documentXml: string }> {
  const zip = await JSZip.loadAsync(template);
  const docXmlFile = zip.file('word/document.xml');
  const relsXmlFile = zip.file('word/_rels/document.xml.rels');

  if (!docXmlFile) {
    throw new Error('Invalid DOCX template: word/document.xml not found.');
  }

  const docXml = await docXmlFile.async('string');
  const relsXml = relsXmlFile ? await relsXmlFile.async('string') : EMPTY_RELATIONSHIPS_XML;
  const rootInfo = parseRootInfo(docXml);
  const masterRelationships = parseRelationships(relsXml);
  const nextDocPrId = maxNumericAttribute(docXml, /<wp:docPr\b[^>]*\bid="(\d+)"/g) + 1;
  const nextBookmarkId =
    maxNumericAttribute(docXml, /<w:(?:bookmarkStart|bookmarkEnd)\b[^>]*\bw:id="(\d+)"/g) + 1;

  const state: LoopExpansionState = {
    counter: 0,
    loopPatches: {},
    includeCounter: 0,
    includeTemplateXmlCache: new Map<string, string>(),
    masterZip: zip,
    masterRelationships,
    masterNamespaces: rootInfo.namespaces,
    masterIgnorablePrefixes: rootInfo.ignorablePrefixes,
    additionalNamespaces: new Map<string, string>(),
    additionalIgnorablePrefixes: new Set<string>(),
    nextDocPrId,
    nextBookmarkId,
    requestId,
    onAnnexProgress: callbacks?.onAnnexProgress,
  };

  let expandedXml = stripEmptyParagraphsBeforeTables(
    await expandLoops(docXml, data, state)
  );
  expandedXml = applyRootInfo(expandedXml, state);

  zip.file('word/document.xml', expandedXml);
  zip.file('word/_rels/document.xml.rels', serializeRelationships(state.masterRelationships));
  const expandedTemplate = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    template: Buffer.from(expandedTemplate),
    loopPatches: state.loopPatches,
    documentXml: expandedXml,
  };
}

async function renderDocxTemplate(
  templateFileName: string,
  context: Record<string, unknown>,
  basePatchPayloads: Record<string, PatchPayload> = {},
  requestId?: string,
  callbacks?: RenderCallbacks
): Promise<Buffer> {
  const renderStartedAt = Date.now();
  const verboseRenderLog = templateFileName === 'executive-synthesis.docx';
  const templatePath = resolve(TEMPLATES_DIR, templateFileName);
  const templateBuffer = await readFile(templatePath);

  const expandStartedAt = Date.now();
  const {
    template: expandedTemplate,
    loopPatches,
  } = await expandTemplateLoops(templateBuffer, context, requestId, callbacks);
  if (verboseRenderLog) {
    logDocx(
      `render template="${templateFileName}" expand=${Date.now() - expandStartedAt}ms`,
      requestId
    );
  }

  const payloads: Record<string, PatchPayload> = {
    ...basePatchPayloads,
    ...loopPatches,
  };

  const patchZip = await JSZip.loadAsync(expandedTemplate);
  const allInstances: Record<string, PlaceholderInstance> = {};
  const wordXmlParts = Object.keys(patchZip.files)
    .filter((fileName) => fileName.startsWith('word/') && fileName.endsWith('.xml'))
    .sort();

  for (const [index, fileName] of wordXmlParts.entries()) {
    const file = patchZip.file(fileName);
    if (!file) continue;
    const xml = await file.async('string');
    if (!xml.includes('{{')) continue;
    const normalized = unwrapPlaceholderContentControls(xml);

    if (verboseRenderLog && normalized.unwrappedCount > 0) {
      logDocx(
        `render template="${templateFileName}" unwrapped sdt=${normalized.unwrappedCount} file="${fileName}"`,
        requestId
      );
    }

    const rewritten = rewritePlaceholderInstances(normalized.xml, `${index}_`);
    if (Object.keys(rewritten.instances).length === 0) continue;

    patchZip.file(fileName, rewritten.rewrittenXml);
    Object.assign(allInstances, rewritten.instances);
  }

  const patchableTemplate = Buffer.from(await patchZip.generateAsync({ type: 'nodebuffer' }));
  const placeholders = await patchDetector({ data: patchableTemplate });
  if (verboseRenderLog) {
    logDocx(
      `render template="${templateFileName}" placeholders=${placeholders.length} instances=${Object.keys(allInstances).length} loopPatches=${Object.keys(loopPatches).length}`,
      requestId
    );
  }

  const patches: Record<string, IPatch> = {};
  placeholders.forEach((placeholder) => {
    const instance = allInstances[placeholder];
    const sourcePlaceholder = instance?.sourcePlaceholder ?? placeholder;
    const payload = placeholderToPayload(sourcePlaceholder, context, payloads);
    patches[placeholder] = toPatch(payload, instance?.baseStyle ?? {});
  });

  const patchStartedAt = Date.now();
  if (callbacks?.onPatchStart) {
    await callbacks.onPatchStart();
  }
  const result = await patchDocument({
    outputType: 'nodebuffer',
    data: patchableTemplate,
    patches,
    keepOriginalStyles: true,
    placeholderDelimiters: {
      start: '{{',
      end: '}}',
    },
  });
  if (verboseRenderLog) {
    logDocx(
      `render template="${templateFileName}" patch=${Date.now() - patchStartedAt}ms total=${Date.now() - renderStartedAt}ms`,
      requestId
    );
  }

  let rendered: Buffer = Buffer.from(result);
  rendered = await replaceTemplateImagePlaceholders(rendered, context, requestId);
  rendered = await replaceUnresolvedPatchInstances(rendered, allInstances, context, payloads, requestId);
  await assertNoUnresolvedPatchInstances(rendered, requestId);
  rendered = await enableUpdateFieldsOnOpen(rendered);
  return Buffer.from(rendered);
}

function toNumberList(values: Array<number | null | undefined>): number[] {
  return values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
}

function median(values: Array<number | null | undefined>): number {
  const sorted = toNumberList(values);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function normalizeExecutiveSummaryReferences(
  references: ExecutiveSummaryContent['references']
): Array<{ title: string; url: string; excerpt: string; link: string }> {
  if (!Array.isArray(references)) return [];

  return references
    .map((reference) => {
      const title = safeText(reference?.title);
      const url = safeText(reference?.url);
      const excerpt = safeText(reference?.excerpt);
      return {
        title,
        url,
        excerpt,
        link: toMarkdownLink(title, url),
      };
    })
    .filter((reference) => reference.title || reference.url);
}

function parseDashboardImageInput(value: unknown): DashboardImageInput | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    dataBase64: typeof obj.dataBase64 === 'string' ? obj.dataBase64 : undefined,
    dataUrl: typeof obj.dataUrl === 'string' ? obj.dataUrl : undefined,
    mimeType: typeof obj.mimeType === 'string' ? obj.mimeType : undefined,
    assetId: typeof obj.assetId === 'string' ? obj.assetId : undefined,
    widthPx: typeof obj.widthPx === 'number' ? obj.widthPx : undefined,
    heightPx: typeof obj.heightPx === 'number' ? obj.heightPx : undefined,
  };
}

function parseDataUrl(input: string): { base64: string; mimeType: string | null } | null {
  const trimmed = input.trim();
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(trimmed);
  if (!match) return null;
  return {
    mimeType: safeText(match[1]).toLowerCase() || null,
    base64: match[2] ?? '',
  };
}

function decodeBase64ToBuffer(input: string): Buffer | null {
  const compact = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!compact) return null;
  try {
    const bytes = Buffer.from(compact, 'base64');
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

function detectImageType(
  buffer: Buffer,
  mimeTypeHint?: string | null
): 'jpg' | 'png' | 'gif' | 'bmp' | null {
  const hint = safeText(mimeTypeHint).toLowerCase();
  if (hint === 'image/png') return 'png';
  if (hint === 'image/jpeg' || hint === 'image/jpg') return 'jpg';
  if (hint === 'image/gif') return 'gif';
  if (hint === 'image/bmp') return 'bmp';

  if (buffer.byteLength >= 8) {
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'png';
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  }

  return null;
}

function detectImageSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.byteLength >= 24) {
    const pngSig = buffer.subarray(0, 8);
    const isPng =
      pngSig[0] === 0x89 &&
      pngSig[1] === 0x50 &&
      pngSig[2] === 0x4e &&
      pngSig[3] === 0x47 &&
      pngSig[4] === 0x0d &&
      pngSig[5] === 0x0a &&
      pngSig[6] === 0x1a &&
      pngSig[7] === 0x0a;
    if (isPng) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
  }

  if (buffer.byteLength >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.byteLength) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 8 < buffer.byteLength) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) return { width, height };
        break;
      }
      offset += 2 + length;
    }
  }

  return null;
}

function toClampedPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < DASHBOARD_IMAGE_MIN_PX) return null;
  return rounded;
}

function fitDashboardImageDimensions(params: {
  sourceSize: { width: number; height: number } | null;
  requestedWidthPx: number | null;
  requestedHeightPx: number | null;
}): { widthPx: number; heightPx: number } {
  const { sourceSize, requestedWidthPx, requestedHeightPx } = params;

  if (requestedWidthPx && requestedHeightPx) {
    return {
      widthPx: requestedWidthPx,
      heightPx: requestedHeightPx,
    };
  }

  if (sourceSize && sourceSize.width > 0 && sourceSize.height > 0) {
    const width = requestedWidthPx ?? sourceSize.width;
    const height = requestedHeightPx ?? sourceSize.height;
    const ratio = Math.min(
      DASHBOARD_IMAGE_MAX_WIDTH_PX / width,
      DASHBOARD_IMAGE_MAX_HEIGHT_PX / height
    );
    const scaledWidth = Math.max(DASHBOARD_IMAGE_MIN_PX, Math.round(width * ratio));
    const scaledHeight = Math.max(DASHBOARD_IMAGE_MIN_PX, Math.round(height * ratio));
    return { widthPx: scaledWidth, heightPx: scaledHeight };
  }

  return {
    widthPx: requestedWidthPx ?? DASHBOARD_IMAGE_MAX_WIDTH_PX,
    heightPx: requestedHeightPx ?? DASHBOARD_IMAGE_MAX_HEIGHT_PX,
  };
}

function parseAssetPointer(assetId: string): { bucket: string; key: string } | null {
  const trimmed = assetId.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('s3://')) {
    try {
      const url = new URL(trimmed);
      const bucket = url.hostname;
      const key = url.pathname.replace(/^\/+/, '');
      if (!bucket || !key) return null;
      return { bucket, key };
    } catch {
      return null;
    }
  }

  return {
    bucket: getDocumentsBucketName(),
    key: trimmed,
  };
}

async function resolveImagePatchValueFromUnknown(
  rawValue: unknown,
  requestId?: string,
  logLabel: string = 'template image'
): Promise<ImagePatchValue | null> {
  const imageInput = parseDashboardImageInput(rawValue);
  if (!imageInput) return null;

  const requestedWidthPx = toClampedPositiveInt(imageInput.widthPx);
  const requestedHeightPx = toClampedPositiveInt(imageInput.heightPx);

  let buffer: Buffer | null = null;
  let mimeTypeHint: string | null = safeText(imageInput.mimeType).toLowerCase() || null;

  const inlineBase64 =
    (typeof imageInput.dataBase64 === 'string' && imageInput.dataBase64.trim()) ||
    (typeof imageInput.dataUrl === 'string' && imageInput.dataUrl.trim()) ||
    '';
  if (inlineBase64) {
    const fromDataUrl = parseDataUrl(inlineBase64);
    const base64 = fromDataUrl?.base64 ?? inlineBase64;
    mimeTypeHint = fromDataUrl?.mimeType ?? mimeTypeHint;
    buffer = decodeBase64ToBuffer(base64);
  }

  if (!buffer && imageInput.assetId) {
    const pointer = parseAssetPointer(imageInput.assetId);
    if (pointer) {
      try {
        const bytes = await getObjectBytes(pointer);
        buffer = Buffer.from(bytes);
      } catch (error: unknown) {
        logDocx(
          `${logLabel} asset fetch failed assetId="${imageInput.assetId}" error="${error instanceof Error ? error.message : String(error)}"`,
          requestId
        );
      }
    }
  }

  if (!buffer || buffer.byteLength === 0) return null;

  const imageType = detectImageType(buffer, mimeTypeHint);
  if (!imageType) {
    logDocx(`${logLabel} fallback: unsupported format`, requestId);
    return null;
  }

  const sourceSize = detectImageSize(buffer);
  const fitted = fitDashboardImageDimensions({
    sourceSize,
    requestedWidthPx,
    requestedHeightPx,
  });

  logDocx(
    `${logLabel} resolved bytes=${buffer.byteLength} width=${fitted.widthPx} height=${fitted.heightPx}`,
    requestId
  );

  return {
    type: imageType,
    data: buffer,
    widthPx: fitted.widthPx,
    heightPx: fitted.heightPx,
  };
}

async function resolveDashboardImagePatchPayload(
  provided: Record<string, unknown>,
  requestId?: string
): Promise<PatchPayload> {
  const dashboardImageRaw = resolvePath(provided, 'dashboardImage');
  const resolved = await resolveImagePatchValueFromUnknown(
    dashboardImageRaw,
    requestId,
    'dashboard image'
  );
  if (!resolved) return { mode: 'plain', value: '' };

  return {
    mode: 'image',
    value: resolved satisfies ImagePatchValue,
  };
}

function buildExecutiveSynthesisContext(input: ExecutiveSynthesisDocxInput): Record<string, unknown> {
  const executiveSummary = input.executiveSummary ?? {};
  const normalizedReferences = normalizeExecutiveSummaryReferences(executiveSummary.references);
  const locale = safeText(input.locale).toLowerCase().startsWith('en') ? 'en' : 'fr';

  const usecasesForAnnex = input.useCases.map((useCase) => ({
    ...useCase,
    data: buildTemplateData(useCase, input.matrix),
  }));

  const medianValue = median(usecasesForAnnex.map((useCase) => useCase.totalValueScore));
  const medianComplexity = median(usecasesForAnnex.map((useCase) => useCase.totalComplexityScore));
  const quickWinsCount = usecasesForAnnex.filter((useCase) => {
    const value = useCase.totalValueScore ?? 0;
    const complexity = useCase.totalComplexityScore ?? 0;
    return value >= medianValue && complexity <= medianComplexity;
  }).length;

  const provided = { ...(input.provided ?? {}) };
  const providedReportTitle = resolvePath(provided, 'report.title');
  const providedAnnexTitle = resolvePath(provided, 'annex.title');
  const providedAnnexSubtitle = resolvePath(provided, 'annex.subtitle');

  return {
    report: {
      title:
        typeof providedReportTitle === 'string' && providedReportTitle.trim()
          ? providedReportTitle
          : locale === 'en'
            ? 'Top AI Ideas Report'
            : 'Rapport Top AI Ideas',
    },
    folder: {
      name: safeText(input.folderName),
      executiveSummary: {
        introduction: safeText(executiveSummary.introduction),
        analyse: safeText(executiveSummary.analyse),
        recommandation: safeText(executiveSummary.recommandation),
        synthese_executive: safeText(executiveSummary.synthese_executive),
        references: normalizedReferences,
      },
      execSummary: {
        // Alias kept for template compatibility: same structured array as executiveSummary.references.
        references: normalizedReferences,
      },
    },
    stats: {
      totalUsecases: usecasesForAnnex.length,
      medianValue,
      medianComplexity,
      quickWinsCount,
    },
    annex: {
      title:
        typeof providedAnnexTitle === 'string' && providedAnnexTitle.trim()
          ? providedAnnexTitle
          : locale === 'en'
            ? 'Annex'
            : 'Annexes',
      subtitle:
        typeof providedAnnexSubtitle === 'string' && providedAnnexSubtitle.trim()
          ? providedAnnexSubtitle
          : locale === 'en'
            ? 'Use cases'
            : "Cas d'usage",
    },
    backCover: {
      title: '',
      subtitle: '',
      p1: '',
      p2: '',
      p3: '',
    },
    provided: {
      ...provided,
    },
    controls: input.controls ?? {},
    usecases: usecasesForAnnex,
  };
}

export async function generateUseCaseDocx(useCase: UseCase, matrix: MatrixConfig | null): Promise<Buffer> {
  const data = buildTemplateData(useCase, matrix);
  return renderDocxTemplate('usecase-onepage.docx', data, basePayloads(data));
}

export async function generateExecutiveSynthesisDocx(input: ExecutiveSynthesisDocxInput): Promise<Buffer> {
  const startedAt = Date.now();
  await input.onProgress?.({
    state: 'rendering',
    progress: 25,
    message: 'Starting executive synthesis rendering',
  });
  logDocx(
    `executive synthesis start folder="${safeText(input.folderName)}" usecases=${input.useCases.length}`,
    input.requestId
  );
  const context = buildExecutiveSynthesisContext(input);
  const imagePatch = await resolveDashboardImagePatchPayload(
    (input.provided ?? {}) as Record<string, unknown>,
    input.requestId
  );
  const result = await renderDocxTemplate(
    'executive-synthesis.docx',
    context,
    {
      'provided.dashboardImage': imagePatch,
    },
    input.requestId,
    {
    onAnnexProgress: async (current: number, total: number) => {
      const ratio = total > 0 ? current / total : 1;
      const progress = Math.max(30, Math.min(85, Math.round(30 + ratio * 55)));
      await input.onProgress?.({
        state: 'rendering_annex',
        progress,
        current,
        total,
      });
    },
    onPatchStart: async () => {
      await input.onProgress?.({
        state: 'patching',
        progress: 90,
        message: 'Applying DOCX patches',
      });
    },
  }
  );
  await input.onProgress?.({
    state: 'packaging',
    progress: 97,
    message: 'Finalizing DOCX package',
  });
  logDocx(
    `executive synthesis done in ${Date.now() - startedAt}ms bytes=${result.byteLength}`,
    input.requestId
  );
  await input.onProgress?.({
    state: 'done',
    progress: 100,
  });
  return result;
}
