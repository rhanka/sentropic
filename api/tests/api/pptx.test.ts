import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { jobQueue } from '../../src/db/schema';
import * as storageS3 from '../../src/services/storage-s3';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('PPTX API', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  it('returns 409 when download is requested for pending job', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'pptx_generate',
      status: 'pending',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({
        entityType: 'folder',
        entityId: createTestId(),
        mode: 'freeform',
        format: 'pptx',
      }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/pptx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(String(data.message)).toContain('still running');
  });

  it('returns 400 when job type is not pptx_generate', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'docx_generate',
      status: 'completed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({ entityType: 'folder', entityId: createTestId() }),
      result: JSON.stringify({ ok: true }),
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/pptx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(400);
  });

  it('returns 422 with failure details for failed pptx jobs', async () => {
    const jobId = createTestId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'pptx_generate',
      status: 'failed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({
        entityType: 'folder',
        entityId: createTestId(),
        mode: 'freeform',
        format: 'pptx',
      }),
      error: 'pptx packaging error',
      createdAt: new Date(),
    });

    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/pptx/jobs/${jobId}/download`,
      user.sessionToken!
    );

    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.message).toBe('PPTX generation failed');
    expect(String(data.error)).toContain('pptx packaging error');
  });

  it('returns pptx bytes from S3 storage key result', async () => {
    const storageSpy = vi.spyOn(storageS3, 'getObjectBytes');
    const raw = Buffer.from('s3-pptx-bytes');
    storageSpy.mockResolvedValue(new Uint8Array(raw));

    try {
      const jobId = createTestId();
      await db.insert(jobQueue).values({
        id: jobId,
        type: 'pptx_generate',
        status: 'completed',
        workspaceId: user.workspaceId!,
        data: JSON.stringify({
          entityType: 'folder',
          entityId: createTestId(),
          mode: 'freeform',
          format: 'pptx',
        }),
        result: JSON.stringify({
          fileName: 'from-s3.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          storageBucket: 'docs-test',
          storageKey: 'pptx/test/file.pptx',
        }),
        createdAt: new Date(),
      });

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/pptx/jobs/${jobId}/download`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');
      expect(response.headers.get('content-disposition')).toContain('from-s3.pptx');
      expect(storageSpy).toHaveBeenCalledWith({ bucket: 'docs-test', key: 'pptx/test/file.pptx' });
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.equals(raw)).toBe(true);
    } finally {
      storageSpy.mockRestore();
    }
  });
});

