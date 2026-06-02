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
  id: string;
  name: string;
  value: number;
  complexity: number;
  quadrant: QuadrantLabel;
};

/**
 * Cross-sheet anchors emitted by the matrix sheet so the use-cases tab can build
 * live weighted-mean formulas that reference the matrix axis weights.
 *
 * - `sheetRef` is the formula-safe (quoted when needed) sheet name.
 * - `valueWeightCells` / `complexityWeightCells` map an axis id to the absolute
 *   address of the cell holding that axis weight (e.g. `$B$4`).
 */
type MatrixAnchors = {
  sheetName: string;
  sheetRef: string;
  valueWeightCells: Record<string, string>;
  complexityWeightCells: Record<string, string>;
};

/**
 * Anchors emitted by the use-cases sheet so the quadrant tab can reference the
 * already-computed score cells (keeping the whole chain matrix-driven and live).
 */
type UseCasesAnchors = {
  sheetName: string;
  sheetRef: string;
  /** Initiative id -> 1-based worksheet row index in the use-cases tab. */
  rowById: Record<string, number>;
  /** Column letters of the score/quadrant columns in the use-cases tab. */
  valueCol: string;
  complexityCol: string;
  /** First/last data row indices (for MEDIAN ranges). */
  firstRow: number;
  lastRow: number;
};

/** Build a formula-safe sheet reference, quoting when the name needs it. */
function sheetRefOf(sheetName: string): string {
  const needsQuote = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName);
  return needsQuote ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
}

/** Convert a 1-based column index to its spreadsheet letter (1 -> A, 27 -> AA). */
function columnLetter(index: number): string {
  let n = index;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Set a worksheet display order. `orderNo` is supported by exceljs at runtime but
 * absent from its public type defs, so it is set via a narrow typed accessor.
 */
function setSheetOrder(sheet: ExcelJS.Worksheet | undefined, orderNo: number): void {
  if (sheet) {
    (sheet as ExcelJS.Worksheet & { orderNo: number }).orderNo = orderNo;
  }
}

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

/** An exceljs formula cell value carrying both the live formula and a cached result. */
type FormulaCell = { formula: string; result: number | string };

/**
 * Build the live weighted-mean score formula for a single initiative, mirroring
 * `calculateScores`: ROUND( Σ(rating_i × weight_i) / Σ(weight_i) ).
 *
 * Ratings are inlined as literals (per-initiative source data); axis weights are
 * referenced cross-sheet against the matrix tab, so editing a weight there
 * recomputes the score. Returns `null` when no rated axis maps to a weight cell.
 */
function buildWeightedScoreFormula(
  matrixRef: string,
  weightCells: Record<string, string>,
  scores: ScoreEntry[],
  computed: number
): FormulaCell | null {
  const terms: string[] = [];
  const weights: string[] = [];
  for (const entry of scores) {
    const cell = weightCells[entry.axisId];
    if (!cell) continue;
    const weightRef = `${matrixRef}!${cell}`;
    terms.push(`${entry.rating}*${weightRef}`);
    weights.push(weightRef);
  }
  if (terms.length === 0) return null;
  const numerator = terms.join('+');
  const denominator = weights.join('+');
  return {
    formula: `ROUND((${numerator})/(${denominator}),0)`,
    result: computed,
  };
}

/**
 * Build the live quadrant-label formula referencing the value/complexity score
 * cells and their column medians. Mirrors `classifyQuadrant`
 * (high value + low complexity => quick win) and returns the localized label
 * for each branch. `result` carries the JS-computed label so it displays before
 * a recalc.
 */
function buildQuadrantFormula(
  valueCellRef: string,
  complexityCellRef: string,
  valueMedianRange: string,
  complexityMedianRange: string,
  t: Record<string, string>,
  computed: QuadrantLabel
): FormulaCell {
  const highValue = `${valueCellRef}>=MEDIAN(${valueMedianRange})`;
  const lowComplexity = `${complexityCellRef}<=MEDIAN(${complexityMedianRange})`;
  const q = (label: QuadrantLabel) => `"${t[label].replace(/"/g, '""')}"`;
  const formula =
    `IF(AND(${highValue},${lowComplexity}),${q('quick_win')},` +
    `IF(${highValue},${q('major_project')},` +
    `IF(${lowComplexity},${q('fill_in')},${q('thankless_task')})))`;
  return { formula, result: t[computed] };
}

function buildQuadrantRows(source: FolderXlsxSource): QuadrantRow[] {
  const scored = source.initiatives
    .map((initiative) => ({
      id: initiative.id,
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

/**
 * Build the use-cases sheet. Score and quadrant cells are emitted as LIVE Excel
 * formulas (not static values): the value/complexity scores are weighted-mean
 * formulas referencing the matrix tab axis weights (cross-sheet), and the
 * quadrant label is an IF/MEDIAN formula over the score columns. Each formula
 * carries a cached `result` so the value shows before a recalc.
 *
 * Returns `UseCasesAnchors` so the quadrant tab can reference these score cells.
 */
function buildUseCasesSheet(
  workbook: ExcelJS.Workbook,
  source: FolderXlsxSource,
  t: Record<string, string>,
  matrix: MatrixAnchors | null
): UseCasesAnchors {
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

  // Column letters (1-based): name=A .. valueScore=G, complexityScore=H, quadrant=I.
  const valueCol = columnLetter(7);
  const complexityCol = columnLetter(8);
  const quadrantCol = columnLetter(9);

  const medianValue = median(
    source.initiatives.filter(() => source.matrix).map((i) => i.totalValueScore ?? 0)
  );
  const medianComplexity = median(
    source.initiatives.filter(() => source.matrix).map((i) => i.totalComplexityScore ?? 0)
  );

  const rowById: Record<string, number> = {};
  const firstRow = 2;

  for (const initiative of source.initiatives) {
    const value = initiative.totalValueScore ?? 0;
    const complexity = initiative.totalComplexityScore ?? 0;
    const row = sheet.addRow({
      name: safeText(initiative.data.name),
      domain: safeText(initiative.data.domain),
      status: safeText(initiative.status),
      description: safeText(initiative.data.description),
      problem: safeText(initiative.data.problem),
      solution: safeText(initiative.data.solution),
    });
    rowById[initiative.id] = row.number;

    if (!matrix || !source.matrix) {
      row.getCell('valueScore').value = '';
      row.getCell('complexityScore').value = '';
      row.getCell('quadrant').value = '';
      continue;
    }

    const valueFormula = buildWeightedScoreFormula(
      matrix.sheetRef,
      matrix.valueWeightCells,
      initiative.data.valueScores ?? [],
      value
    );
    const complexityFormula = buildWeightedScoreFormula(
      matrix.sheetRef,
      matrix.complexityWeightCells,
      initiative.data.complexityScores ?? [],
      complexity
    );

    row.getCell('valueScore').value = valueFormula ?? value;
    row.getCell('complexityScore').value = complexityFormula ?? complexity;
  }

  const lastRow = Math.max(firstRow, firstRow + source.initiatives.length - 1);

  // Second pass: quadrant formulas reference the score columns + their medians.
  if (matrix && source.matrix && source.initiatives.length > 0) {
    const valueRange = `$${valueCol}$${firstRow}:$${valueCol}$${lastRow}`;
    const complexityRange = `$${complexityCol}$${firstRow}:$${complexityCol}$${lastRow}`;
    for (const initiative of source.initiatives) {
      const rowNumber = rowById[initiative.id];
      const value = initiative.totalValueScore ?? 0;
      const complexity = initiative.totalComplexityScore ?? 0;
      const computed = classifyQuadrant(value, complexity, medianValue, medianComplexity);
      const quadrantFormula = buildQuadrantFormula(
        `$${valueCol}$${rowNumber}`,
        `$${complexityCol}$${rowNumber}`,
        valueRange,
        complexityRange,
        t,
        computed
      );
      sheet.getCell(`${quadrantCol}${rowNumber}`).value = quadrantFormula;
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  return {
    sheetName: t.useCasesTab,
    sheetRef: sheetRefOf(t.useCasesTab),
    rowById,
    valueCol,
    complexityCol,
    firstRow,
    lastRow,
  };
}

/**
 * Build the evaluation matrix sheet and return cross-sheet anchors (axis weight
 * cell addresses) so the use-cases tab can reference the weights in live formulas.
 * Returns `null` when the folder has no matrix.
 */
function buildMatrixSheet(
  workbook: ExcelJS.Workbook,
  source: FolderXlsxSource,
  t: Record<string, string>
): MatrixAnchors | null {
  const sheet = workbook.addWorksheet(t.matrixTab);
  sheet.getColumn(1).width = 32;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 64;

  if (!source.matrix) {
    sheet.addRow([t.noMatrix]);
    return null;
  }

  const valueWeightCells: Record<string, string> = {};
  const complexityWeightCells: Record<string, string> = {};

  const addAxesSection = (
    title: string,
    axes: MatrixConfig['valueAxes'],
    thresholds: MatrixConfig['valueThresholds'],
    weightCells: Record<string, string>
  ) => {
    const sectionRow = sheet.addRow([title]);
    sectionRow.getCell(1).font = { bold: true, size: 13 };
    const headerRow = sheet.addRow([t.matrixAxis, t.matrixWeight, t.matrixAxisDescription]);
    styleHeaderRow(headerRow);
    for (const axis of axes) {
      const axisRow = sheet.addRow([safeText(axis.name), axis.weight, safeText(axis.description)]);
      // Absolute address of the weight cell (column B) for cross-sheet formulas.
      weightCells[axis.id] = `$B$${axisRow.number}`;
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

  addAxesSection(
    t.matrixSectionValue,
    source.matrix.valueAxes,
    source.matrix.valueThresholds,
    valueWeightCells
  );
  addAxesSection(
    t.matrixSectionComplexity,
    source.matrix.complexityAxes,
    source.matrix.complexityThresholds,
    complexityWeightCells
  );

  return {
    sheetName: t.matrixTab,
    sheetRef: sheetRefOf(t.matrixTab),
    valueWeightCells,
    complexityWeightCells,
  };
}

/**
 * Build the prioritization quadrant sheet and return the cell-range metadata
 * needed to wire the native scatter chart.
 *
 * The value/complexity cells are LIVE cross-sheet references to the use-cases
 * tab score cells (themselves matrix-driven formulas), and the quadrant label
 * is an IF/MEDIAN formula over this tab's own value/complexity columns. Each
 * formula carries a cached `result` so values (and the chart) show before a
 * recalc, while remaining fully editable/recomputing in Excel/LibreOffice.
 */
function buildQuadrantSheet(
  workbook: ExcelJS.Workbook,
  source: FolderXlsxSource,
  t: Record<string, string>,
  useCases: UseCasesAnchors
): { sheetName: string; rowCount: number } {
  const sheet = workbook.addWorksheet(t.quadrantTab);
  sheet.columns = [
    { header: t.colName, key: 'name', width: 32 },
    { header: t.quadValue, key: 'value', width: 16 },
    { header: t.quadComplexity, key: 'complexity', width: 18 },
    { header: t.colQuadrant, key: 'quadrant', width: 18 },
  ];
  styleHeaderRow(sheet.getRow(1));

  // Column letters (1-based): name=A, value=B, complexity=C, quadrant=D.
  const valueCol = columnLetter(2);
  const complexityCol = columnLetter(3);

  const rows = buildQuadrantRows(source);
  const firstRow = 2;
  const lastRow = Math.max(firstRow, firstRow + rows.length - 1);
  const valueRange = `$${valueCol}$${firstRow}:$${valueCol}$${lastRow}`;
  const complexityRange = `$${complexityCol}$${firstRow}:$${complexityCol}$${lastRow}`;

  for (const row of rows) {
    const added = sheet.addRow({ name: row.name });
    const rowNumber = added.number;
    const ucRow = useCases.rowById[row.id];

    // Value/complexity: live cross-sheet refs to the use-cases score cells.
    if (ucRow != null) {
      added.getCell('value').value = {
        formula: `${useCases.sheetRef}!$${useCases.valueCol}$${ucRow}`,
        result: row.value,
      };
      added.getCell('complexity').value = {
        formula: `${useCases.sheetRef}!$${useCases.complexityCol}$${ucRow}`,
        result: row.complexity,
      };
    } else {
      added.getCell('value').value = row.value;
      added.getCell('complexity').value = row.complexity;
    }

    // Quadrant: live IF/MEDIAN formula over this tab's value/complexity columns.
    added.getCell('quadrant').value = buildQuadrantFormula(
      `$${valueCol}$${rowNumber}`,
      `$${complexityCol}$${rowNumber}`,
      valueRange,
      complexityRange,
      t,
      row.quadrant
    );
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

  // Build the matrix sheet first so its axis-weight cell addresses are available
  // as cross-sheet anchors for the use-cases score formulas. Tab order is fixed
  // afterwards (use cases, matrix, quadrant) — purely cosmetic, since cross-sheet
  // formulas reference sheet names, not positions.
  const matrix = buildMatrixSheet(workbook, source, t);
  const useCases = buildUseCasesSheet(workbook, source, t, matrix);
  const quadrant = buildQuadrantSheet(workbook, source, t, useCases);

  // Restore the intended display order: use cases (1), matrix (2), quadrant (3).
  // `orderNo` is supported by exceljs at runtime but missing from its type defs.
  setSheetOrder(workbook.getWorksheet(t.useCasesTab), 1);
  setSheetOrder(workbook.getWorksheet(t.matrixTab), 2);
  setSheetOrder(workbook.getWorksheet(t.quadrantTab), 3);

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
