/**
 * DOCX generation service using docx-templates.
 *
 * Reads a .docx template from `api/templates/` and fills it with use-case data.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from 'docx-templates';
import MarkdownIt from 'markdown-it';
import type { UseCase } from '../types/usecase';
import type { MatrixConfig } from '../types/matrix';
import { fibonacciToStars } from '../utils/fibonacci-mapping';

// Resolve the templates directory relative to *this* source file so it works
// both when running with tsx (src/) and from a bundled dist/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

function markdownToHtml(markdown: string): string {
  const html = md.render(markdown || '');
  return `<meta charset="UTF-8"><body>${html}</body>`;
}

function markdownListToHtml(items: string[]): string {
  if (!items || items.length === 0) return markdownToHtml('');
  const markdown = items.map((item) => `- ${item}`).join('\n');
  return markdownToHtml(markdown);
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
        description: score.description ?? '',
        descriptionHtml: markdownToHtml(score.description ?? ''),
      };
    })
    .filter(Boolean) as Array<{ title: string; score: number; stars: number; description: string }>;
}

function normalizeReference(ref: { title?: string; url?: string; excerpt?: string }) {
  return {
    title: ref.title ?? '',
    url: ref.url ?? '',
    excerpt: ref.excerpt ?? '',
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
    description: d.description ?? '',
    descriptionHtml: markdownToHtml(d.description ?? ''),
    problem: d.problem ?? '',
    problemHtml: markdownToHtml(d.problem ?? ''),
    solution: d.solution ?? '',
    solutionHtml: markdownToHtml(d.solution ?? ''),
    process: d.process ?? '',
    domain: d.domain ?? '',
    technologies: d.technologies ?? [],
    technologiesText: (d.technologies ?? []).join(', '),
    benefits: d.benefits ?? [],
    benefitsText: (d.benefits ?? []).join('\n'),
    benefitsHtml: markdownListToHtml(d.benefits ?? []),
    metrics: d.metrics ?? [],
    metricsText: (d.metrics ?? []).join('\n'),
    metricsHtml: markdownListToHtml(d.metrics ?? []),
    risks: d.risks ?? [],
    risksText: (d.risks ?? []).join('\n'),
    risksHtml: markdownListToHtml(d.risks ?? []),
    constraints: d.constraints ?? [],
    constraintsText: (d.constraints ?? []).join('\n'),
    constraintsHtml: markdownListToHtml(d.constraints ?? []),
    nextSteps: d.nextSteps ?? [],
    nextStepsText: (d.nextSteps ?? []).join('\n'),
    nextStepsHtml: markdownListToHtml(d.nextSteps ?? []),
    dataSources: d.dataSources ?? [],
    dataSourcesText: (d.dataSources ?? []).join(', '),
    dataSourcesHtml: markdownListToHtml(d.dataSources ?? []),
    dataObjects: d.dataObjects ?? [],
    dataObjectsText: (d.dataObjects ?? []).join(', '),
    dataObjectsHtml: markdownListToHtml(d.dataObjects ?? []),
    references,
    referencesText: references
      .map((ref) => [ref.title, ref.url].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('\n'),
    referencesHtml: markdownToHtml(
      references
        .map((ref, index) => `${index + 1}. ${[ref.title, ref.url].filter(Boolean).join(' — ')}${ref.excerpt ? `\n${ref.excerpt}` : ''}`)
        .join('\n')
    ),
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
