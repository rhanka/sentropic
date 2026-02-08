/**
 * DOCX generation service using dolanmiu/docx.
 *
 * Strategy:
 * 1) load the .docx template from api/templates
 * 2) expand FOR/END-FOR loop blocks directly in word/document.xml
 * 3) patch placeholders with docx.patchDocument while preserving template styles
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  ExternalHyperlink,
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

type PatchMode = 'plain' | 'markdown_inline' | 'markdown_block';

type PatchPayload = {
  mode: PatchMode;
  value: unknown;
};

type BaseRunStyle = {
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

type LoopExpansionState = {
  counter: number;
  loopPatches: Record<string, PatchPayload>;
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');

marked.setOptions({
  gfm: true,
  breaks: true,
});

function safeText(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\r\n/g, '\n');
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item));
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

  if (payload.mode === 'markdown_inline') {
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

function loopExprToPath(loopExpr: string): string {
  return loopExpr.split('||')[0]?.trim() ?? loopExpr.trim();
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

function extractPlaceholderBaseStyles(documentXml: string): Record<string, BaseRunStyle> {
  const styleMap: Record<string, BaseRunStyle> = {};
  const runRegex = /<w:r\b[\s\S]*?<\/w:r>/g;
  let runMatch: RegExpExecArray | null;

  while ((runMatch = runRegex.exec(documentXml)) != null) {
    const runXml = runMatch[0];
    const baseStyle = parseBaseRunStyleFromRunXml(runXml);
    const textRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let textMatch: RegExpExecArray | null;

    while ((textMatch = textRegex.exec(runXml)) != null) {
      const text = textMatch[1];
      const placeholderRegex = /{{\s*([^}]+?)\s*}}/g;
      let placeholderMatch: RegExpExecArray | null;

      while ((placeholderMatch = placeholderRegex.exec(text)) != null) {
        const placeholder = placeholderMatch[1].trim();
        if (!styleMap[placeholder]) {
          styleMap[placeholder] = baseStyle;
        }
      }
    }
  }

  return styleMap;
}

function inferLoopPatchMode(loopVar: string, fieldPath: string): PatchMode {
  const key = `${loopVar}.${fieldPath}`;

  if (key === 'ax.description') return 'markdown_block';
  if (key === 'ref.excerpt') return 'markdown_block';

  if (fieldPath === 'score' || fieldPath === 'stars' || fieldPath === 'crosses') {
    return 'plain';
  }
  if (fieldPath === 'url') return 'markdown_inline';

  return 'markdown_inline';
}

function makeLoopPatchKey(loopVar: string, index: number, fieldPath: string, counter: number): string {
  const field = fieldPath ? fieldPath.replace(/[^a-zA-Z0-9_]/g, '_') : 'value';
  return `__loop_${loopVar}_${index}_${field}_${counter}`;
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

function replaceLoopValuePlaceholders(
  xml: string,
  loopVar: string,
  item: unknown,
  itemIndex: number,
  state: LoopExpansionState
): string {
  const regex = new RegExp(
    `{{\\s*\\$${escapeRegExp(loopVar)}(?:\\.([A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*))?\\s*}}`,
    'g'
  );

  return xml.replace(regex, (_match, fieldPathRaw: string | undefined) => {
    const fieldPath = fieldPathRaw ?? '';
    const resolved = fieldPath ? resolvePath(item, fieldPath) : item;
    const key = makeLoopPatchKey(loopVar, itemIndex, fieldPath, state.counter++);

    state.loopPatches[key] = {
      mode: inferLoopPatchMode(loopVar, fieldPath),
      value: resolved,
    };

    return `{{${key}}}`;
  });
}

function expandLoops(xml: string, scope: Record<string, unknown>, state: LoopExpansionState): string {
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

    const bodyBetweenControlParagraphs =
      hasControlOnlyParagraphs && startParagraph && endParagraph
        ? currentXml.slice(startParagraph.end, endParagraph.start)
        : '';

    const hasTableInLoopBody = /<w:tbl[\s>]/.test(bodyBetweenControlParagraphs);
    const canDropBothControlParagraphs = hasControlOnlyParagraphs && !hasTableInLoopBody;
    const canDropOnlyStartControlParagraph = hasControlOnlyParagraphs && hasTableInLoopBody;

    const innerTemplate = canDropBothControlParagraphs
      ? bodyBetweenControlParagraphs
      : canDropOnlyStartControlParagraph && startParagraph && endParagraph
        ? currentXml.slice(startParagraph.end, endParagraph.start)
        : currentXml.slice(loopStartTokenEnd, loopEndTokenStart);
    const loopPath = loopExprToPath(loop.loopExpr);
    const itemsRaw = resolvePath(scope, loopPath);
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];

    let rendered = '';

    items.forEach((item, index) => {
      const nestedScope: Record<string, unknown> = {
        ...scope,
        [loop.loopVar]: item,
      };

      let piece = expandLoops(innerTemplate, nestedScope, state);
      piece = replaceLoopValuePlaceholders(piece, loop.loopVar, item, index, state);
      rendered += piece;
    });

    if (canDropBothControlParagraphs && startParagraph && endParagraph) {
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

  return currentXml;
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
  data: TemplateData,
  payloads: Record<string, PatchPayload>
): PatchPayload {
  if (payloads[placeholder]) return payloads[placeholder];

  if (placeholder.startsWith('FOR ') || placeholder.startsWith('END-FOR ') || placeholder.startsWith('$')) {
    return { mode: 'plain', value: '' };
  }

  if (placeholder in data) {
    const value = (data as unknown as Record<string, unknown>)[placeholder];
    if (
      placeholder === 'description' ||
      placeholder === 'problem' ||
      placeholder === 'solution'
    ) {
      return { mode: 'markdown_block', value };
    }
    if (
      placeholder === 'name' ||
      placeholder === 'contact' ||
      placeholder === 'deadline' ||
      placeholder === 'process' ||
      placeholder === 'domain'
    ) {
      return { mode: 'markdown_inline', value };
    }
    return { mode: 'plain', value };
  }

  return { mode: 'plain', value: '' };
}

async function expandTemplateLoops(
  template: Buffer,
  data: TemplateData
): Promise<{ template: Buffer; loopPatches: Record<string, PatchPayload>; documentXml: string }> {
  const zip = await JSZip.loadAsync(template);
  const docXmlFile = zip.file('word/document.xml');

  if (!docXmlFile) {
    throw new Error('Invalid DOCX template: word/document.xml not found.');
  }

  const docXml = await docXmlFile.async('string');
  const state: LoopExpansionState = {
    counter: 0,
    loopPatches: {},
  };

  const expandedXml = stripEmptyParagraphsBeforeTables(
    expandLoops(docXml, data as unknown as Record<string, unknown>, state)
  );

  zip.file('word/document.xml', expandedXml);
  const expandedTemplate = await zip.generateAsync({ type: 'nodebuffer' });

  return {
    template: Buffer.from(expandedTemplate),
    loopPatches: state.loopPatches,
    documentXml: expandedXml,
  };
}

export async function generateUseCaseDocx(useCase: UseCase, matrix: MatrixConfig | null): Promise<Buffer> {
  const templatePath = resolve(TEMPLATES_DIR, 'usecase-onepage.docx');
  const templateBuffer = await readFile(templatePath);

  const data = buildTemplateData(useCase, matrix);
  const {
    template: expandedTemplate,
    loopPatches,
    documentXml,
  } = await expandTemplateLoops(templateBuffer, data);

  const payloads: Record<string, PatchPayload> = {
    ...basePayloads(data),
    ...loopPatches,
  };

  const placeholders = await patchDetector({ data: expandedTemplate });
  const placeholderStyles = extractPlaceholderBaseStyles(documentXml);

  const patches: Record<string, IPatch> = {};
  placeholders.forEach((placeholder) => {
    const payload = placeholderToPayload(placeholder, data, payloads);
    patches[placeholder] = toPatch(payload, placeholderStyles[placeholder]);
  });

  const result = await patchDocument({
    outputType: 'nodebuffer',
    data: expandedTemplate,
    patches,
    keepOriginalStyles: true,
    placeholderDelimiters: {
      start: '{{',
      end: '}}',
    },
  });

  return Buffer.from(result);
}
