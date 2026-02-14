import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { folders, jobQueue, useCases } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('DOCX API', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue();
  });

  afterEach(async () => {
    processJobsSpy.mockRestore();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
    await db.delete(useCases).where(eq(useCases.workspaceId, user.workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  async function createFolderAndUseCase() {
    const folderRes = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
      name: `Folder ${createTestId()}`,
      description: 'DOCX test folder',
    });
    expect(folderRes.status).toBe(201);
    const folder = await folderRes.json();

    const useCaseRes = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases',
      user.sessionToken!,
      {
        folderId: folder.id,
        name: `Use case ${createTestId()}`,
        description: 'DOCX test use case',
      }
    );
    expect(useCaseRes.status).toBe(201);
    const useCase = await useCaseRes.json();

    return { folder, useCase };
  }

  it('returns 410 on legacy synchronous endpoint', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/use-cases/${createTestId()}/docx`,
      user.sessionToken!
    );

    expect(response.status).toBe(410);
    const data = await response.json();
    expect(String(data.message)).toContain('Synchronous DOCX download route is disabled');
  });

  it('rejects template/entity mismatch', async () => {
    const response = await authenticatedRequest(app, 'POST', '/api/v1/docx/generate', user.sessionToken!, {
      templateId: 'usecase-onepage',
      entityType: 'folder',
      entityId: createTestId(),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(String(data.message)).toContain('Invalid entityType for templateId usecase-onepage');
  });

  it('accepts options alias and enqueues a docx job', async () => {
    const { useCase } = await createFolderAndUseCase();

    const response = await authenticatedRequest(app, 'POST', '/api/v1/docx/generate', user.sessionToken!, {
      templateId: 'usecase-onepage',
      entityType: 'usecase',
      entityId: useCase.id,
      options: {
        dashboardImage: { dataBase64: 'ZGFzaGJvYXJk' },
      },
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
    expect(job?.type).toBe('docx_generate');

    const payload = JSON.parse(job!.data) as Record<string, unknown>;
    expect(payload.templateId).toBe('usecase-onepage');
    expect(payload.entityType).toBe('usecase');
    expect(payload.entityId).toBe(useCase.id);
    expect((payload.provided as Record<string, unknown>)?.dashboardImage).toBeDefined();
    expect(typeof payload.sourceHash).toBe('string');
  });

  it('reuses the same pending job for identical payload', async () => {
    const { useCase } = await createFolderAndUseCase();
    const payload = {
      templateId: 'usecase-onepage',
      entityType: 'usecase',
      entityId: useCase.id,
    } as const;

    const firstRes = await authenticatedRequest(app, 'POST', '/api/v1/docx/generate', user.sessionToken!, payload);
    expect(firstRes.status).toBe(202);
    const first = await firstRes.json();

    const secondRes = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/docx/generate',
      user.sessionToken!,
      payload
    );
    expect([200, 202]).toContain(secondRes.status);
    const second = await secondRes.json();

    expect(second.jobId).toBe(first.jobId);
    expect(second.queueClass).toBe('publishing');
  });

  it('returns 409 when download is requested for pending job', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'docx_generate',
      status: 'pending',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({
        templateId: 'usecase-onepage',
        entityType: 'usecase',
        entityId: createTestId(),
      }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/docx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(String(data.message)).toContain('still running');
  });

  it('returns 400 when job type is not docx_generate', async () => {
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
      `/api/v1/docx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(400);
  });

  it('returns 422 with failure details for failed docx jobs', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'docx_generate',
      status: 'failed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({
        templateId: 'executive-synthesis-multipage',
        entityType: 'folder',
        entityId: createTestId(),
      }),
      error: 'template marker missing',
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/docx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.message).toBe('DOCX generation failed');
    expect(String(data.error)).toContain('template marker missing');
  });

  it('returns docx bytes from legacy contentBase64 fallback', async () => {
    const jobId = createTestId();
    const raw = Buffer.from('docx-bytes');
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'docx_generate',
      status: 'completed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({
        templateId: 'usecase-onepage',
        entityType: 'usecase',
        entityId: createTestId(),
      }),
      result: JSON.stringify({
        fileName: 'sample.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: raw.toString('base64'),
      }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/docx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(response.headers.get('content-disposition')).toContain('sample.docx');

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(raw)).toBe(true);
  });

  it('enforces workspace isolation on docx download', async () => {
    const otherUser = await createAuthenticatedUser('editor');
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'docx_generate',
      status: 'completed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({
        templateId: 'usecase-onepage',
        entityType: 'usecase',
        entityId: createTestId(),
      }),
      result: JSON.stringify({
        fileName: 'hidden.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: Buffer.from('x').toString('base64'),
      }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/docx/jobs/${jobId}/download`,
      otherUser.sessionToken!
    );
    expect(response.status).toBe(404);
  });
});
