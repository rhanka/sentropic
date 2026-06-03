/**
 * XLSX export routes (asynchronous only), mirroring the DOCX flow.
 *
 * Unified async endpoints:
 * - POST /xlsx/generate (enqueue)
 * - GET  /xlsx/jobs/:id/download (download when completed, S3-stored)
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { queueManager } from '../../services/queue-manager';
import { computeXlsxSourceHash } from '../../services/xlsx-generation';
import { getDocumentsBucketName, getObjectBytes } from '../../services/storage-s3';

const generateXlsxSchema = z.object({
  entityType: z.literal('folder'),
  entityId: z.string().min(1),
});

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const xlsxRouter = new Hono();

xlsxRouter.post('/xlsx/generate', zValidator('json', generateXlsxSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const acceptLanguage = c.req.header('accept-language') || '';
  const requestLocale = acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'fr';
  const xlsxRequestId = randomUUID().slice(0, 8);

  try {
    const sourceHash = await computeXlsxSourceHash({
      entityId: payload.entityId,
      workspaceId: user.workspaceId,
      locale: requestLocale,
    });

    const reusableJob = await queueManager.findLatestXlsxJobBySource({
      workspaceId: user.workspaceId,
      entityId: payload.entityId,
      sourceHash,
    });

    if (reusableJob?.status === 'completed') {
      return c.json(
        {
          success: true,
          jobId: reusableJob.id,
          status: 'completed',
          queueClass: 'publishing',
          streamId: `job_${reusableJob.id}`,
        },
        200
      );
    }

    if (reusableJob && (reusableJob.status === 'pending' || reusableJob.status === 'processing')) {
      return c.json(
        {
          success: true,
          jobId: reusableJob.id,
          status: reusableJob.status,
          queueClass: 'publishing',
          streamId: `job_${reusableJob.id}`,
        },
        202
      );
    }

    await queueManager.invalidateXlsxCacheForEntity({
      workspaceId: user.workspaceId,
      entityId: payload.entityId,
      keepSourceHash: sourceHash,
    });

    const jobId = await queueManager.addJob(
      'xlsx_generate',
      {
        entityType: 'folder',
        entityId: payload.entityId,
        locale: requestLocale,
        requestId: xlsxRequestId,
        sourceHash,
      },
      { workspaceId: user.workspaceId }
    );

    console.log(
      `[XLSX:${xlsxRequestId}] enqueued jobId="${jobId}" entityType="folder" entityId="${payload.entityId}"`
    );

    return c.json(
      {
        success: true,
        jobId,
        status: 'pending',
        queueClass: 'publishing',
        streamId: `job_${jobId}`,
      },
      202
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[XLSX:${xlsxRequestId}] enqueue failed`, message);
    return c.json({ message: 'Failed to enqueue XLSX generation.', error: message }, 422);
  }
});

xlsxRouter.get('/xlsx/jobs/:id/download', async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const jobId = c.req.param('id');

  const job = await queueManager.getJobStatus(jobId, { includeBinaryResult: true });
  if (!job || (job.workspaceId && job.workspaceId !== user.workspaceId)) {
    return c.json({ message: 'Job not found' }, 404);
  }

  if (String(job.type) !== 'xlsx_generate') {
    return c.json({ message: 'Invalid job type for XLSX download' }, 400);
  }

  if (job.status === 'pending' || job.status === 'processing') {
    return c.json({ message: 'XLSX generation is still running' }, 409);
  }

  if (job.status === 'failed') {
    return c.json(
      {
        message: 'XLSX generation failed',
        error: job.error ?? (job.result as { message?: string } | undefined)?.message ?? null,
      },
      422
    );
  }

  const result = (job.result ?? {}) as {
    fileName?: string;
    mimeType?: string;
    contentBase64?: string;
    storageBucket?: string;
    storageKey?: string;
  };

  let buffer: Buffer | null = null;

  if (result.storageKey) {
    const bucket = result.storageBucket || getDocumentsBucketName();
    const bytes = await getObjectBytes({ bucket, key: result.storageKey });
    buffer = Buffer.from(bytes);
  } else if (result.contentBase64) {
    buffer = Buffer.from(result.contentBase64, 'base64');
  }

  if (!buffer) {
    return c.json({ message: 'XLSX content missing in job result' }, 500);
  }

  c.header('Content-Type', result.mimeType || XLSX_MIME);
  c.header('Content-Disposition', `attachment; filename="${result.fileName || `folder-${jobId}.xlsx`}"`);
  return c.body(new Uint8Array(buffer));
});
