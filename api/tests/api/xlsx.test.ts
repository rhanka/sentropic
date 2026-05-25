import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import JSZip from 'jszip';
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
});
