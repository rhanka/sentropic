/**
 * XLSX multi-tab folder export service.
 *
 * Mirrors the asynchronous DOCX generation flow (queue job + S3 storage):
 * a folder is rendered into a single workbook with three tabs:
 *   1. Use cases     — one row per initiative (name, domain, status, description,
 *                      problem, solution, total value score, total complexity score, quadrant)
 *   2. Evaluation matrix — value/complexity axes definitions + scoring grid
 *   3. Prioritization quadrant — data rows (value/complexity + computed quadrant label,
 *                      sorted by priority) PLUS a NATIVE editable XY scatter chart that
 *                      references the quadrant sheet cell ranges.
 *
 * Writer: `exceljs` (data tabs + styling). `exceljs` can read but cannot WRITE charts,
 * so the native scatter chart is produced by injecting the OOXML chart part
 * (`xl/charts/chart1.xml` + drawing relationships) directly into the workbook zip.
 * No PNG image fallback.
 */

import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../db/client';
import { folders, initiatives } from '../db/schema';
import type { MatrixConfig } from '../types/matrix';
import type { Initiative, InitiativeData, ScoreEntry } from '../types/initiative';
import { parseMatrixConfig } from '../utils/matrix';
import { calculateInitiativeScores } from '../utils/scoring';
import { injectScatterChart } from './xlsx-chart';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type XlsxGenerateRequest = {
  entityId: string;
  workspaceId: string;
  locale?: string;
};

export type XlsxGenerateResult = {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

export type QuadrantLabel = 'quick_win' | 'major_project' | 'fill_in' | 'thankless_task';

type FolderXlsxSource = {
  folderName: string;
  initiatives: Initiative[];
  matrix: MatrixConfig | null;
};

type QuadrantRow = {
  name: string;
  value: number;
  complexity: number;
  quadrant: QuadrantLabel;
};

const I18N: Record<'fr' | 'en', Record<string, string>> = {
  en: {
    useCasesTab: 'Use cases',
    matrixTab: 'Evaluation matrix',
    quadrantTab: 'Prioritization quadrant',
    colName: 'Name',
    colDomain: 'Domain',
    colStatus: 'Status',
    colDescription: 'Description',
    colProblem: 'Problem',
    colSolution: 'Solution',
    colValueScore: 'Total value score',
    colComplexityScore: 'Total complexity score',
    colQuadrant: 'Quadrant',
    matrixSectionValue: 'Value axes',
    matrixSectionComplexity: 'Complexity axes',
    matrixAxis: 'Axis',
    matrixWeight: 'Weight',
    matrixAxisDescription: 'Description',
    matrixThresholds: 'Thresholds',
    matrixThresholdLevel: 'Level',
    matrixThresholdPoints: 'Points',
    quadValue: 'Value (0-100)',
    quadComplexity: 'Complexity (0-100)',
    chartTitle: 'Value / Complexity prioritization',
    chartXAxis: 'Complexity',
    chartYAxis: 'Value',
    quick_win: 'Quick win',
    major_project: 'Major project',
    fill_in: 'Fill-in',
    thankless_task: 'Thankless task',
    noMatrix: 'No evaluation matrix configured for this folder.',
  },
  fr: {
    useCasesTab: "Cas d'usage",
    matrixTab: "Matrice d'évaluation",
    quadrantTab: 'Quadrant de priorisation',
    colName: 'Nom',
    colDomain: 'Domaine',
    colStatus: 'Statut',
    colDescription: 'Description',
    colProblem: 'Problème',
    colSolution: 'Solution',
    colValueScore: 'Score de valeur total',
    colComplexityScore: 'Score de complexité total',
    colQuadrant: 'Quadrant',
    matrixSectionValue: 'Axes de valeur',
    matrixSectionComplexity: 'Axes de complexité',
    matrixAxis: 'Axe',
    matrixWeight: 'Poids',
    matrixAxisDescription: 'Description',
    matrixThresholds: 'Seuils',
    matrixThresholdLevel: 'Niveau',
    matrixThresholdPoints: 'Points',
    quadValue: 'Valeur (0-100)',
    quadComplexity: 'Complexité (0-100)',
    chartTitle: 'Priorisation valeur / complexité',
    chartXAxis: 'Complexité',
    chartYAxis: 'Valeur',
    quick_win: 'Gain rapide',
    major_project: 'Projet majeur',
    fill_in: 'Optionnel',
    thankless_task: 'Ingrat',
    noMatrix: "Aucune matrice d'évaluation configurée pour ce dossier.",
  },
};

function pickLocale(locale?: string): 'fr' | 'en' {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

function safeText(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

/** Minimal slug helper (ASCII, lowercase, hyphens). */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function extractInitiativeData(row: typeof initiatives.$inferSelect): InitiativeData {
  let data: Partial<InitiativeData> = {};
  try {
    if (row.data && typeof row.data === 'object') {
      data = row.data as Partial<InitiativeData>;
    } else if (typeof row.data === 'string') {
      data = JSON.parse(row.data) as Partial<InitiativeData>;
    }
  } catch {
    data = {};
  }
  if (!data.name) data.name = "Cas d'usage sans nom";
  return data as InitiativeData;
}

export async function loadFolderXlsxSource(
  input: XlsxGenerateRequest
): Promise<FolderXlsxSource> {
  const [folder] = await db
    .select({
      id: folders.id,
      name: folders.name,
      matrixConfig: folders.matrixConfig,
    })
    .from(folders)
    .where(and(eq(folders.id, input.entityId), eq(folders.workspaceId, input.workspaceId)));

  if (!folder) {
    throw new Error('not_found');
  }

  const rows = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.folderId, folder.id), eq(initiatives.workspaceId, input.workspaceId)))
    .orderBy(asc(initiatives.createdAt));

  const matrix = parseMatrixConfig(folder.matrixConfig ?? null);

  const hydrated: Initiative[] = rows.map((row) => {
    const data = extractInitiativeData(row);
    const computed = calculateInitiativeScores(matrix, data);
    return {
      id: row.id,
      folderId: row.folderId,
      organizationId: row.organizationId,
      status: row.status ?? 'completed',
      model: row.model,
      createdAt: row.createdAt,
      data,
      totalValueScore: computed?.totalValueScore ?? null,
      totalComplexityScore: computed?.totalComplexityScore ?? null,
    } satisfies Initiative;
  });

  return {
    folderName: folder.name,
    initiatives: hydrated,
    matrix,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Quadrant label from value/complexity vs. medians.
 * Mirrors the dashboard ROI semantics: X = complexity, Y = value.
 * High value + low complexity => quick win (top-left ROI quadrant).
 */
function classifyQuadrant(
  value: number,
  complexity: number,
  medianValue: number,
  medianComplexity: number
): QuadrantLabel {
  const highValue = value >= medianValue;
  const lowComplexity = complexity <= medianComplexity;
  if (highValue && lowComplexity) return 'quick_win';
  if (highValue && !lowComplexity) return 'major_project';
  if (!highValue && lowComplexity) return 'fill_in';
  return 'thankless_task';
}

/** Priority rank for sorting (lower = higher priority). */
const QUADRANT_PRIORITY: Record<QuadrantLabel, number> = {
  quick_win: 0,
  major_project: 1,
  fill_in: 2,
  thankless_task: 3,
};

function buildQuadrantRows(source: FolderXlsxSource): QuadrantRow[] {
  const scored = source.initiatives
    .map((initiative) => ({
      name: safeText(initiative.data.name),
      value: initiative.totalValueScore ?? 0,
      complexity: initiative.totalComplexityScore ?? 0,
    }))
    .filter(() => source.matrix != null);

  const medianValue = median(scored.map((row) => row.value));
  const medianComplexity = median(scored.map((row) => row.complexity));

  const rows = scored.map((row) => ({
    ...row,
    quadrant: classifyQuadrant(row.value, row.complexity, medianValue, medianComplexity),
  }));

  // Sort by priority, then by descending value, then ascending complexity.
  rows.sort((a, b) => {
    if (QUADRANT_PRIORITY[a.quadrant] !== QUADRANT_PRIORITY[b.quadrant]) {
      return QUADRANT_PRIORITY[a.quadrant] - QUADRANT_PRIORITY[b.quadrant];
    }
    if (b.value !== a.value) return b.value - a.value;
    return a.complexity - b.complexity;
  });

  return rows;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}

function buildUseCasesSheet(
  workbook: ExcelJS.Workbook,
  source: FolderXlsxSource,
  t: Record<string, string>
): void {
  const sheet = workbook.addWorksheet(t.useCasesTab);
  sheet.columns = [
    { header: t.colName, key: 'name', width: 32 },
    { header: t.colDomain, key: 'domain', width: 20 },
    { header: t.colStatus, key: 'status', width: 14 },
    { header: t.colDescription, key: 'description', width: 48 },
    { header: t.colProblem, key: 'problem', width: 48 },
    { header: t.colSolution, key: 'solution', width: 48 },
    { header: t.colValueScore, key: 'valueScore', width: 18 },
    { header: t.colComplexityScore, key: 'complexityScore', width: 22 },
    { header: t.colQuadrant, key: 'quadrant', width: 18 },
  ];
  styleHeaderRow(sheet.getRow(1));

  const medianValue = median(
    source.initiatives.filter(() => source.matrix).map((i) => i.totalValueScore ?? 0)
  );
  const medianComplexity = median(
    source.initiatives.filter(() => source.matrix).map((i) => i.totalComplexityScore ?? 0)
  );

  for (const initiative of source.initiatives) {
    const value = initiative.totalValueScore ?? 0;
    const complexity = initiative.totalComplexityScore ?? 0;
    const quadrant = source.matrix
      ? t[classifyQuadrant(value, complexity, medianValue, medianComplexity)]
      : '';
    sheet.addRow({
      name: safeText(initiative.data.name),
      domain: safeText(initiative.data.domain),
      status: safeText(initiative.status),
      description: safeText(initiative.data.description),
      problem: safeText(initiative.data.problem),
      solution: safeText(initiative.data.solution),
      valueScore: source.matrix ? value : '',
      complexityScore: source.matrix ? complexity : '',
      quadrant,
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function buildMatrixSheet(
  workbook: ExcelJS.Workbook,
  source: FolderXlsxSource,
  t: Record<string, string>
): void {
  const sheet = workbook.addWorksheet(t.matrixTab);
  sheet.getColumn(1).width = 32;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 64;

  if (!source.matrix) {
    sheet.addRow([t.noMatrix]);
    return;
  }

  const addAxesSection = (
    title: string,
    axes: MatrixConfig['valueAxes'],
    thresholds: MatrixConfig['valueThresholds']
  ) => {
    const sectionRow = sheet.addRow([title]);
    sectionRow.getCell(1).font = { bold: true, size: 13 };
    const headerRow = sheet.addRow([t.matrixAxis, t.matrixWeight, t.matrixAxisDescription]);
    styleHeaderRow(headerRow);
    for (const axis of axes) {
      sheet.addRow([safeText(axis.name), axis.weight, safeText(axis.description)]);
    }
    sheet.addRow([]);
    const thRow = sheet.addRow([t.matrixThresholds]);
    thRow.getCell(1).font = { bold: true };
    const thHeader = sheet.addRow([t.matrixThresholdLevel, t.matrixThresholdPoints]);
    styleHeaderRow(thHeader);
    for (const threshold of thresholds) {
      sheet.addRow([threshold.level, threshold.points]);
    }
    sheet.addRow([]);
  };

  addAxesSection(t.matrixSectionValue, source.matrix.valueAxes, source.matrix.valueThresholds);
  addAxesSection(
    t.matrixSectionComplexity,
    source.matrix.complexityAxes,
    source.matrix.complexityThresholds
  );
}

/**
 * Build the prioritization quadrant sheet (data rows) and return the cell-range
 * metadata needed to wire the native scatter chart.
 */
function buildQuadrantSheet(
  workbook: ExcelJS.Workbook,
  source: FolderXlsxSource,
  t: Record<string, string>
): { sheetName: string; rowCount: number } {
  const sheet = workbook.addWorksheet(t.quadrantTab);
  sheet.columns = [
    { header: t.colName, key: 'name', width: 32 },
    { header: t.quadValue, key: 'value', width: 16 },
    { header: t.quadComplexity, key: 'complexity', width: 18 },
    { header: t.colQuadrant, key: 'quadrant', width: 18 },
  ];
  styleHeaderRow(sheet.getRow(1));

  const rows = buildQuadrantRows(source);
  for (const row of rows) {
    sheet.addRow({
      name: row.name,
      value: row.value,
      complexity: row.complexity,
      quadrant: t[row.quadrant],
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return { sheetName: t.quadrantTab, rowCount: rows.length };
}

function normalizeForHash(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = normalizeForHash(input[key]);
    }
    return out;
  }
  return safeText(value);
}

/**
 * Stable hash of the folder snapshot used to cache/reuse generated workbooks.
 * Mirrors the DOCX source-hash strategy.
 */
export async function computeXlsxSourceHash(input: XlsxGenerateRequest): Promise<string> {
  const source = await loadFolderXlsxSource(input);
  const snapshot = {
    entityType: 'folder',
    entityId: input.entityId,
    locale: pickLocale(input.locale),
    source: {
      folderName: source.folderName,
      matrix: source.matrix,
      initiatives: source.initiatives.map((initiative) => ({
        id: initiative.id,
        status: initiative.status,
        data: initiative.data,
        totalValueScore: initiative.totalValueScore,
        totalComplexityScore: initiative.totalComplexityScore,
      })),
    },
  };
  const serialized = JSON.stringify(normalizeForHash(snapshot));
  return createHash('sha256').update(serialized).digest('hex');
}

export async function generateFolderXlsx(
  input: XlsxGenerateRequest
): Promise<XlsxGenerateResult> {
  const source = await loadFolderXlsxSource(input);
  const locale = pickLocale(input.locale);
  const t = I18N[locale];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sentropic';
  workbook.created = new Date();

  buildUseCasesSheet(workbook, source, t);
  buildMatrixSheet(workbook, source, t);
  const quadrant = buildQuadrantSheet(workbook, source, t);

  const baseBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

  // Inject the native editable scatter chart referencing the quadrant sheet ranges.
  const finalBuffer = await injectScatterChart(baseBuffer, {
    sheetName: quadrant.sheetName,
    rowCount: quadrant.rowCount,
    title: t.chartTitle,
    xAxisTitle: t.chartXAxis,
    yAxisTitle: t.chartYAxis,
    // Column layout: A=name, B=value, C=complexity (1-based: name=1,value=2,complexity=3)
    nameCol: 1,
    xCol: 3, // complexity on X
    yCol: 2, // value on Y
  });

  const folderSlug = slugify(source.folderName) || 'folder';
  return {
    buffer: finalBuffer,
    mimeType: XLSX_MIME,
    fileName: `folder-${input.entityId}-${folderSlug}.xlsx`,
  };
}

export type { ScoreEntry };
