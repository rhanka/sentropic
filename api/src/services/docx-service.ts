/**
 * DOCX generation service using docx-templates.
 *
 * Reads a .docx template from `api/templates/` and fills it with use-case data.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from 'docx-templates';
import { marked } from 'marked';
import type { UseCase } from '../types/usecase';
import type { MatrixConfig } from '../types/matrix';
import { fibonacciToStars } from '../utils/fibonacci-mapping';

// Resolve the templates directory relative to *this* source file so it works
// both when running with tsx (src/) and from a bundled dist/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
});

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownToLiteralXmlRuns(markdown: string): string {
  const normalized = (markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*+]\s+/, '• '))
    .join('\n');
  const source = normalized.replace(/\|\|/g, '| |');
  const parts: Array<{ text: string; bold: boolean; italic: boolean }> = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('**', i)) {
      const end = source.indexOf('**', i + 2);
      if (end !== -1) {
        parts.push({ text: source.slice(i + 2, end), bold: true, italic: false });
        i = end + 2;
        continue;
      }
    }
    if (source.startsWith('*', i)) {
      const end = source.indexOf('*', i + 1);
      if (end !== -1) {
        parts.push({ text: source.slice(i + 1, end), bold: false, italic: true });
        i = end + 1;
        continue;
      }
    }
    const nextBold = source.indexOf('**', i);
    const nextItalic = source.indexOf('*', i);
    const candidates = [nextBold, nextItalic].filter((v) => v !== -1);
    const next = candidates.length > 0 ? Math.min(...candidates) : source.length;
    parts.push({ text: source.slice(i, next), bold: false, italic: false });
    i = next;
  }

  const runs: string[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const segments = part.text.split('\n');
    segments.forEach((segment, index) => {
      const runProps = part.bold || part.italic
        ? `<w:rPr>${part.bold ? '<w:b/>' : ''}${part.italic ? '<w:i/>' : ''}</w:rPr>`
        : '';
      runs.push(`<w:r>${runProps}<w:t xml:space="preserve">${escapeXml(segment)}</w:t></w:r>`);
      if (index < segments.length - 1) {
        runs.push('<w:r><w:br/></w:r>');
      }
    });
  }
  return `||${runs.join('')}||`;
}

/**
 * Generate a one-page use-case DOCX from a template.
 *
 * @param useCase - A hydrated UseCase object (with data populated).
 * @returns Buffer containing the generated .docx bytes.
 */
function buildAxes(
  axes: MatrixConfig['valueAxes'],
  scores: Array<{ axisId: string; rating: number; description?: string }> | undefined
) {
  if (!axes || axes.length === 0) return [];
  const items = scores ?? [];
  return axes
    .map((axis) => {
      const score = items.find((entry) => entry.axisId === axis.id);
      if (!score) return null;
      return {
        title: axis.name,
        score: score.rating,
        stars: fibonacciToStars(Number(score.rating)),
        description: markdownToLiteralXmlRuns(score.description ?? ''),
      };
    })
    .filter(Boolean) as Array<{ title: string; score: number; stars: number; description: string }>;
}

function normalizeReference(ref: { title?: string; url?: string; excerpt?: string }) {
  return {
    title: markdownToLiteralXmlRuns(ref.title ?? ''),
    url: ref.url ?? '',
    excerpt: markdownToLiteralXmlRuns(ref.excerpt ?? ''),
  };
}

async function createReportWithFallback(data: Record<string, unknown>, template: Buffer): Promise<Uint8Array> {
  const maxRetries = 5;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await createReport({
        template,
        data,
        cmdDelimiter: ['{{', '}}'],
      });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const missingMatch = message.match(/ReferenceError:\s+([a-zA-Z0-9_]+)\s+is not defined/);
      if (!missingMatch) throw error;
      const missingKey = missingMatch[1];
      if (missingKey && !(missingKey in data)) {
        data[missingKey] = '';
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
  throw new Error('Template rendering failed after resolving missing fields.');
}

export async function generateUseCaseDocx(
  useCase: UseCase,
  matrix: MatrixConfig | null
): Promise<Buffer> {
  const templatePath = resolve(TEMPLATES_DIR, 'usecase-onepage.docx');
  const templateBuf = await readFile(templatePath);

  const d = useCase.data;
  const references = Array.isArray(d.references) ? d.references.map(normalizeReference) : [];
  const valueAxes = buildAxes(matrix?.valueAxes ?? [], d.valueScores);
  const complexityAxes = buildAxes(matrix?.complexityAxes ?? [], d.complexityScores);

  // Prepare flat data for the template.
  // Arrays are joined with newlines so they render naturally inside a single
  // Word paragraph (the template can also use FOR loops for richer formatting).
  const data = {
    id: useCase.id,
    name: d.name,
    description: markdownToLiteralXmlRuns(d.description ?? ''),
    problem: markdownToLiteralXmlRuns(d.problem ?? ''),
    solution: markdownToLiteralXmlRuns(d.solution ?? ''),
    process: d.process ?? '',
    domain: d.domain ?? '',
    technologies: (d.technologies ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    technologiesText: (d.technologies ?? []).join(', '),
    benefits: (d.benefits ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    benefitsText: (d.benefits ?? []).join('\n'),
    metrics: (d.metrics ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    metricsText: (d.metrics ?? []).join('\n'),
    risks: (d.risks ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    risksText: (d.risks ?? []).join('\n'),
    constraints: (d.constraints ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    constraintsText: (d.constraints ?? []).join('\n'),
    nextSteps: (d.nextSteps ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    nextStepsText: (d.nextSteps ?? []).join('\n'),
    dataSources: (d.dataSources ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    dataSourcesText: (d.dataSources ?? []).join(', '),
    dataObjects: (d.dataObjects ?? []).map((item) => markdownToLiteralXmlRuns(item)),
    dataObjectsText: (d.dataObjects ?? []).join(', '),
    references,
    referencesText: references
      .map((ref) => [ref.title, ref.url].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('\n'),
    valueAxes,
    complexityAxes,
    deadline: d.deadline ?? '',
    contact: d.contact ?? '',
    totalValueScore: useCase.totalValueScore ?? '',
    totalComplexityScore: useCase.totalComplexityScore ?? '',
    createdAt: typeof useCase.createdAt === 'string'
      ? useCase.createdAt
      : useCase.createdAt?.toISOString?.() ?? '',
  };

  const result = await createReportWithFallback(data, templateBuf);

  return Buffer.from(result);
}
