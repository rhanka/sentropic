/**
 * DOCX generation service using docx-templates.
 *
 * Reads a .docx template from `api/templates/` and fills it with use-case data.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from 'docx-templates';
import JSZip from 'jszip';
import MarkdownIt from 'markdown-it';
import type { UseCase } from '../types/usecase';
import type { MatrixConfig } from '../types/matrix';
import { fibonacciToStars } from '../utils/fibonacci-mapping';

// Resolve the templates directory relative to *this* source file so it works
// both when running with tsx (src/) and from a bundled dist/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const HTML_EXPRESSIONS = [
  'description',
  'problem',
  'solution',
  'benefit',
  'metric',
  'risk',
  'constraint',
  'step',
  'tech',
  'dataSource',
  'dataObject',
  'ref.title',
  'ref.url',
  'ref.excerpt',
  'ax.description',
];

function markdownToHtml(markdown: string): string {
  const html = md.render(markdown || '');
  return `<meta charset="UTF-8"><body>${html}</body>`;
}

function markdownItemToHtml(item: string): string {
  return markdownToHtml(item || '');
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
        description: markdownToHtml(score.description ?? ''),
      };
    })
    .filter(Boolean) as Array<{ title: string; score: number; stars: number; description: string }>;
}

function normalizeReference(ref: { title?: string; url?: string; excerpt?: string }) {
  return {
    title: ref.title ?? '',
    url: ref.url ?? '',
    excerpt: markdownToHtml(ref.excerpt ?? ''),
  };
}

async function injectHtmlCommands(template: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return template;
  let updated = docXml;
  for (const expr of HTML_EXPRESSIONS) {
    const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const basic = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g');
    const ins = new RegExp(`\\{\\{\\s*INS\\s+${escaped}\\s*\\}\\}`, 'g');
    updated = updated.replace(basic, `{{HTML ${expr}}}`);
    updated = updated.replace(ins, `{{HTML ${expr}}}`);
  }
  zip.file('word/document.xml', updated);
  return await zip.generateAsync({ type: 'nodebuffer' });
}

async function createReportWithFallback(data: Record<string, unknown>, template: Buffer): Promise<Uint8Array> {
  const maxRetries = 5;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const templateWithHtml = await injectHtmlCommands(template);
      return await createReport({
        template: templateWithHtml,
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
    description: markdownToHtml(d.description ?? ''),
    problem: markdownToHtml(d.problem ?? ''),
    solution: markdownToHtml(d.solution ?? ''),
    process: d.process ?? '',
    domain: d.domain ?? '',
    technologies: (d.technologies ?? []).map((item) => markdownItemToHtml(item)),
    technologiesText: (d.technologies ?? []).join(', '),
    benefits: (d.benefits ?? []).map((item) => markdownItemToHtml(item)),
    benefitsText: (d.benefits ?? []).join('\n'),
    metrics: (d.metrics ?? []).map((item) => markdownItemToHtml(item)),
    metricsText: (d.metrics ?? []).join('\n'),
    risks: (d.risks ?? []).map((item) => markdownItemToHtml(item)),
    risksText: (d.risks ?? []).join('\n'),
    constraints: (d.constraints ?? []).map((item) => markdownItemToHtml(item)),
    constraintsText: (d.constraints ?? []).join('\n'),
    nextSteps: (d.nextSteps ?? []).map((item) => markdownItemToHtml(item)),
    nextStepsText: (d.nextSteps ?? []).join('\n'),
    dataSources: (d.dataSources ?? []).map((item) => markdownItemToHtml(item)),
    dataSourcesText: (d.dataSources ?? []).join(', '),
    dataObjects: (d.dataObjects ?? []).map((item) => markdownItemToHtml(item)),
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
