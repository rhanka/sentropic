import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { folders, jobQueue, initiatives } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import * as storageS3 from '../../src/services/storage-s3';
import { generateFolderXlsx } from '../../src/services/xlsx-generation';
import { defaultMatrixConfig } from '../../src/config/default-matrix';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('XLSX API', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue();
  });

  afterEach(async () => {
    processJobsSpy.mockRestore();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
    await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  async function createFolderWithInitiative() {
    const folderRes = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
      name: `Folder ${createTestId()}`,
      description: 'XLSX test folder',
    });
    expect(folderRes.status).toBe(201);
    const folder = await folderRes.json();

    const initiativeRes = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives',
      user.sessionToken!,
      {
        folderId: folder.id,
        name: `Use case ${createTestId()}`,
        description: 'XLSX test use case',
        domain: 'Operations',
        problem: 'Slow process',
        solution: 'Automate it',
      }
    );
    expect(initiativeRes.status).toBe(201);
    const initiative = await initiativeRes.json();

    return { folder, initiative };
  }

  it('rejects non-folder entity types via schema validation', async () => {
    const response = await authenticatedRequest(app, 'POST', '/api/v1/xlsx/generate', user.sessionToken!, {
      entityType: 'initiative',
      entityId: createTestId(),
    });
    expect(response.status).toBe(400);
  });

  it('enqueues an xlsx_generate job for a folder', async () => {
    const { folder } = await createFolderWithInitiative();

    const response = await authenticatedRequest(app, 'POST', '/api/v1/xlsx/generate', user.sessionToken!, {
      entityType: 'folder',
      entityId: folder.id,
    });

    expect(response.status).toBe(202);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.jobId).toBeDefined();
    expect(data.queueClass).toBe('publishing');
    expect(data.streamId).toBe(`job_${data.jobId}`);

    const [job] = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.id, data.jobId), eq(jobQueue.workspaceId, user.workspaceId)))
      .limit(1);

    expect(job).toBeDefined();
    expect(job?.type).toBe('xlsx_generate');

    const payload = JSON.parse(job!.data) as Record<string, unknown>;
    expect(payload.entityType).toBe('folder');
    expect(payload.entityId).toBe(folder.id);
    expect(typeof payload.sourceHash).toBe('string');
  });

  it('reuses the same pending job for identical payload', async () => {
    const { folder } = await createFolderWithInitiative();
    const body = { entityType: 'folder', entityId: folder.id } as const;

    const firstRes = await authenticatedRequest(app, 'POST', '/api/v1/xlsx/generate', user.sessionToken!, body);
    expect(firstRes.status).toBe(202);
    const first = await firstRes.json();

    const secondRes = await authenticatedRequest(app, 'POST', '/api/v1/xlsx/generate', user.sessionToken!, body);
    expect([200, 202]).toContain(secondRes.status);
    const second = await secondRes.json();
    expect(second.jobId).toBe(first.jobId);
    expect(second.queueClass).toBe('publishing');
  });

  it('creates a new job for a different locale', async () => {
    const { folder } = await createFolderWithInitiative();
    const body = { entityType: 'folder', entityId: folder.id } as const;

    const enRes = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/xlsx/generate',
      user.sessionToken!,
      body,
      { 'Accept-Language': 'en-US' }
    );
    const en = await enRes.json();
    const frRes = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/xlsx/generate',
      user.sessionToken!,
      body,
      { 'Accept-Language': 'fr-FR' }
    );
    const fr = await frRes.json();

    expect(fr.jobId).not.toBe(en.jobId);
  });

  it('returns 409 when download is requested for a pending job', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'xlsx_generate',
      status: 'pending',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({ entityType: 'folder', entityId: createTestId() }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/xlsx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(String(data.message)).toContain('still running');
  });

  it('returns 400 when job type is not xlsx_generate', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'organization_enrich',
      status: 'completed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({ organizationId: createTestId() }),
      result: JSON.stringify({ ok: true }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/xlsx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(400);
  });

  it('returns 422 with failure details for failed xlsx jobs', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'xlsx_generate',
      status: 'failed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({ entityType: 'folder', entityId: createTestId() }),
      error: 'folder not found',
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/xlsx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.message).toBe('XLSX generation failed');
    expect(String(data.error)).toContain('folder not found');
  });

  it('returns xlsx bytes from S3 storage key result', async () => {
    const raw = Buffer.from('xlsx-s3-bytes');
    const storageSpy = vi
      .spyOn(storageS3, 'getObjectBytes')
      .mockResolvedValue(new Uint8Array(raw));

    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'xlsx_generate',
      status: 'completed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({ entityType: 'folder', entityId: createTestId() }),
      result: JSON.stringify({
        fileName: 'folder.xlsx',
        mimeType: XLSX_MIME,
        storageBucket: 'documents',
        storageKey: 'xlsx-cache/key.xlsx',
      }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/xlsx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(XLSX_MIME);
    expect(response.headers.get('content-disposition')).toContain('folder.xlsx');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(raw)).toBe(true);
    storageSpy.mockRestore();
  });

  it('generates a workbook with 3 tabs and a native scatter chart part', async () => {
    const folderId = createTestId();
    await db.insert(folders).values({
      id: folderId,
      name: 'Scored folder',
      description: 'has matrix',
      workspaceId: user.workspaceId!,
      matrixConfig: JSON.stringify(defaultMatrixConfig),
      createdAt: new Date(),
    });

    const valueAxisId = defaultMatrixConfig.valueAxes[0].id;
    const complexityAxisId = defaultMatrixConfig.complexityAxes[0].id;

    await db.insert(initiatives).values({
      id: createTestId(),
      folderId,
      workspaceId: user.workspaceId!,
      status: 'completed',
      data: {
        name: 'Case A',
        domain: 'Ops',
        description: 'desc',
        problem: 'prob',
        solution: 'sol',
        valueScores: [{ axisId: valueAxisId, rating: 89, description: '' }],
        complexityScores: [{ axisId: complexityAxisId, rating: 8, description: '' }],
      },
      createdAt: new Date(),
    });

    const result = await generateFolderXlsx({
      entityId: folderId,
      workspaceId: user.workspaceId!,
      locale: 'en',
    });

    expect(result.mimeType).toBe(XLSX_MIME);
    expect(result.fileName).toContain('.xlsx');

    const zip = await JSZip.loadAsync(result.buffer);
    // Native chart parts present (OOXML injection).
    expect(zip.file('xl/charts/chart1.xml')).not.toBeNull();
    expect(zip.file('xl/drawings/drawing1.xml')).not.toBeNull();
    const chartXml = await zip.file('xl/charts/chart1.xml')!.async('string');
    expect(chartXml).toContain('<c:scatterChart>');
    const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
    expect(contentTypes).toContain('/xl/charts/chart1.xml');

    // Three worksheets present in the workbook part.
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    const sheetCount = (workbookXml.match(/<sheet\b/g) || []).length;
    expect(sheetCount).toBe(3);
  });

  // --- Live-formula read-back verification (no LibreOffice / no Python sidecar) ---
  // Reopen the generated workbook with exceljs and assert that the score/quadrant
  // cells carry live cross-sheet formulas (not static values), that the cached
  // results are coherent, and that no formula-error tokens are present.
  const ERROR_TOKENS = ['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NUM!', '#NULL!'];

  async function generateScoredWorkbook(locale: 'en' | 'fr') {
    const folderId = createTestId();
    await db.insert(folders).values({
      id: folderId,
      name: 'Scored folder',
      description: 'has matrix',
      workspaceId: user.workspaceId!,
      matrixConfig: JSON.stringify(defaultMatrixConfig),
      createdAt: new Date(),
    });

    const v = defaultMatrixConfig.valueAxes;
    const c = defaultMatrixConfig.complexityAxes;

    // Two initiatives with full per-axis ratings so weighted means are well-defined.
    await db.insert(initiatives).values([
      {
        id: createTestId(),
        folderId,
        workspaceId: user.workspaceId!,
        status: 'completed',
        data: {
          name: 'Case A',
          domain: 'Ops',
          description: 'desc',
          problem: 'prob',
          solution: 'sol',
          valueScores: v.map((axis, i) => ({ axisId: axis.id, rating: 80 + i, description: '' })),
          complexityScores: c.map((axis, i) => ({ axisId: axis.id, rating: 20 + i, description: '' })),
        },
        createdAt: new Date(),
      },
      {
        id: createTestId(),
        folderId,
        workspaceId: user.workspaceId!,
        status: 'completed',
        data: {
          name: 'Case B',
          domain: 'Sales',
          description: 'desc',
          problem: 'prob',
          solution: 'sol',
          valueScores: v.map((axis, i) => ({ axisId: axis.id, rating: 30 + i, description: '' })),
          complexityScores: c.map((axis, i) => ({ axisId: axis.id, rating: 70 + i, description: '' })),
        },
        createdAt: new Date(),
      },
    ]);

    const result = await generateFolderXlsx({
      entityId: folderId,
      workspaceId: user.workspaceId!,
      locale,
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
    return wb;
  }

  it('writes live cross-sheet score formulas referencing the matrix tab', async () => {
    const wb = await generateScoredWorkbook('en');

    const useCases = wb.getWorksheet('Use cases')!;
    expect(useCases).toBeDefined();

    // Columns: G=value score, H=complexity score, I=quadrant. Data rows 2..3.
    for (const rowNumber of [2, 3]) {
      const valueCell = useCases.getCell(`G${rowNumber}`);
      const complexityCell = useCases.getCell(`H${rowNumber}`);

      // exceljs surfaces formula cells as { formula, result }.
      expect(valueCell.type).toBe(ExcelJS.ValueType.Formula);
      expect(complexityCell.type).toBe(ExcelJS.ValueType.Formula);

      const valueFormula = (valueCell.value as ExcelJS.CellFormulaValue).formula;
      const complexityFormula = (complexityCell.value as ExcelJS.CellFormulaValue).formula;

      // Cross-sheet reference to the matrix tab + ROUND wrapper (weighted mean).
      expect(valueFormula).toContain("'Evaluation matrix'!");
      expect(valueFormula).toContain('ROUND(');
      expect(complexityFormula).toContain("'Evaluation matrix'!");
      expect(complexityFormula).toContain('ROUND(');

      // Cached result is a coherent 0..100 score.
      const valueResult = (valueCell.value as ExcelJS.CellFormulaValue).result as number;
      const complexityResult = (complexityCell.value as ExcelJS.CellFormulaValue).result as number;
      expect(typeof valueResult).toBe('number');
      expect(valueResult).toBeGreaterThanOrEqual(0);
      expect(valueResult).toBeLessThanOrEqual(100);
      expect(typeof complexityResult).toBe('number');
      expect(complexityResult).toBeGreaterThanOrEqual(0);
      expect(complexityResult).toBeLessThanOrEqual(100);
    }
  });

  it('writes live quadrant formulas (IF/MEDIAN) on both score-bearing tabs', async () => {
    const wb = await generateScoredWorkbook('en');

    const useCases = wb.getWorksheet('Use cases')!;
    const quadrant = wb.getWorksheet('Prioritization quadrant')!;
    expect(quadrant).toBeDefined();

    for (const rowNumber of [2, 3]) {
      // Use-cases quadrant column I = IF/MEDIAN formula.
      const ucQuadrant = useCases.getCell(`I${rowNumber}`);
      expect(ucQuadrant.type).toBe(ExcelJS.ValueType.Formula);
      const ucFormula = (ucQuadrant.value as ExcelJS.CellFormulaValue).formula;
      expect(ucFormula).toContain('IF(');
      expect(ucFormula).toContain('MEDIAN(');
      // Cached label is one of the localized quadrant labels.
      const ucLabel = (ucQuadrant.value as ExcelJS.CellFormulaValue).result as string;
      expect(['Quick win', 'Major project', 'Fill-in', 'Thankless task']).toContain(ucLabel);

      // Quadrant tab value (B) / complexity (C) are cross-sheet refs to use cases.
      const qValue = quadrant.getCell(`B${rowNumber}`);
      const qComplexity = quadrant.getCell(`C${rowNumber}`);
      expect(qValue.type).toBe(ExcelJS.ValueType.Formula);
      expect(qComplexity.type).toBe(ExcelJS.ValueType.Formula);
      expect((qValue.value as ExcelJS.CellFormulaValue).formula).toContain("'Use cases'!");
      expect((qComplexity.value as ExcelJS.CellFormulaValue).formula).toContain("'Use cases'!");

      // Quadrant tab label column D = IF/MEDIAN formula.
      const qQuadrant = quadrant.getCell(`D${rowNumber}`);
      expect(qQuadrant.type).toBe(ExcelJS.ValueType.Formula);
      expect((qQuadrant.value as ExcelJS.CellFormulaValue).formula).toContain('IF(');
    }
  });

  it('produces no formula-error tokens anywhere in the workbook', async () => {
    const wb = await generateScoredWorkbook('fr');

    for (const sheet of wb.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          // Inspect both formula strings and cached results / static values.
          const parts: string[] = [];
          if (cell.type === ExcelJS.ValueType.Formula) {
            const fv = cell.value as ExcelJS.CellFormulaValue;
            parts.push(String(fv.formula ?? ''));
            parts.push(String(fv.result ?? ''));
          } else if (cell.value != null) {
            parts.push(String(cell.value));
          }
          for (const token of ERROR_TOKENS) {
            for (const part of parts) {
              expect(part.includes(token)).toBe(false);
            }
          }
        });
      });
    }
  });
});
