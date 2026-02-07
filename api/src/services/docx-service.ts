/**
 * DOCX generation service using docx-templates.
 *
 * Reads a .docx template from `api/templates/` and fills it with use-case data.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from 'docx-templates';
import type { UseCase } from '../types/usecase';

// Resolve the templates directory relative to *this* source file so it works
// both when running with tsx (src/) and from a bundled dist/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');

/**
 * Generate a one-page use-case DOCX from a template.
 *
 * @param useCase - A hydrated UseCase object (with data populated).
 * @returns Buffer containing the generated .docx bytes.
 */
export async function generateUseCaseDocx(useCase: UseCase): Promise<Buffer> {
  const templatePath = resolve(TEMPLATES_DIR, 'usecase-onepage.docx');
  const templateBuf = await readFile(templatePath);

  const d = useCase.data;

  // Prepare flat data for the template.
  // Arrays are joined with newlines so they render naturally inside a single
  // Word paragraph (the template can also use FOR loops for richer formatting).
  const data = {
    id: useCase.id,
    name: d.name,
    description: d.description ?? '',
    problem: d.problem ?? '',
    solution: d.solution ?? '',
    process: d.process ?? '',
    domain: d.domain ?? '',
    technologies: d.technologies ?? [],
    technologiesText: (d.technologies ?? []).join(', '),
    benefits: d.benefits ?? [],
    benefitsText: (d.benefits ?? []).join('\n'),
    metrics: d.metrics ?? [],
    metricsText: (d.metrics ?? []).join('\n'),
    risks: d.risks ?? [],
    risksText: (d.risks ?? []).join('\n'),
    constraints: d.constraints ?? [],
    constraintsText: (d.constraints ?? []).join('\n'),
    nextSteps: d.nextSteps ?? [],
    nextStepsText: (d.nextSteps ?? []).join('\n'),
    dataSources: d.dataSources ?? [],
    dataSourcesText: (d.dataSources ?? []).join(', '),
    dataObjects: d.dataObjects ?? [],
    dataObjectsText: (d.dataObjects ?? []).join(', '),
    deadline: d.deadline ?? '',
    contact: d.contact ?? '',
    totalValueScore: useCase.totalValueScore ?? '',
    totalComplexityScore: useCase.totalComplexityScore ?? '',
    createdAt: typeof useCase.createdAt === 'string'
      ? useCase.createdAt
      : useCase.createdAt?.toISOString?.() ?? '',
  };

  const result = await createReport({
    template: templateBuf,
    data,
    cmdDelimiter: ['{{', '}}'],
  });

  return Buffer.from(result);
}
