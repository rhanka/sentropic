/**
 * DOCX export routes (asynchronous only).
 *
 * Legacy sync route is intentionally disabled to avoid API saturation:
 * - GET /use-cases/:id/docx -> 410 Gone
 *
 * Unified async endpoint:
 * - POST /docx/generate (enqueue)
 * - GET /docx/jobs/:id/download (download when completed)
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { queueManager } from '../../services/queue-manager';
import {
  computeDocxSourceHash,
  getExpectedEntityType,
} from '../../services/docx-generation';
import { getDocumentsBucketName, getObjectBytes } from '../../services/storage-s3';

const generateDocxSchema = z.object({
  templateId: z.enum(['usecase-onepage', 'executive-synthesis-multipage']),
  entityType: z.enum(['usecase', 'folder']),
  entityId: z.string().min(1),
  provided: z.record(z.unknown()).optional(),
  controls: z.record(z.unknown()).optional(),
  // Backward-compatible alias (to be removed after migration)
  options: z.record(z.unknown()).optional(),
});

export const docxRouter = new Hono();

docxRouter.get('/use-cases/:id/docx', (c) =>
  c.json(
    {
      message:
        'Synchronous DOCX download route is disabled. Use POST /api/v1/docx/generate and GET /api/v1/docx/jobs/:id/download.',
    },
    410
  )
);

docxRouter.post('/docx/generate', zValidator('json', generateDocxSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const acceptLanguage = c.req.header('accept-language') || '';
  const requestLocale = acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'fr';
  const docxRequestId = randomUUID().slice(0, 8);

  const expectedEntityType = getExpectedEntityType(payload.templateId);
  if (payload.entityType !== expectedEntityType) {
    return c.json(
      {
        message: `Invalid entityType for templateId ${payload.templateId}. Expected ${expectedEntityType}.`,
      },
      400
    );
  }

  try {
    const sourceHash = await computeDocxSourceHash({
      templateId: payload.templateId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      workspaceId: user.workspaceId,
      provided: payload.provided ?? payload.options ?? {},
      controls: payload.controls ?? {},
      locale: requestLocale,
    });

    const reusableJob = await queueManager.findLatestDocxJobBySource({
      workspaceId: user.workspaceId,
      templateId: payload.templateId,
      entityType: payload.entityType,
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

    await queueManager.invalidateDocxCacheForEntity({
      workspaceId: user.workspaceId,
      templateId: payload.templateId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      keepSourceHash: sourceHash,
    });

    const jobId = await queueManager.addJob(
      'docx_generate',
      {
        templateId: payload.templateId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        provided: payload.provided ?? payload.options ?? {},
        controls: payload.controls ?? {},
        locale: requestLocale,
        requestId: docxRequestId,
        sourceHash,
      },
      { workspaceId: user.workspaceId }
    );

    console.log(
      `[DOCX:${docxRequestId}] enqueued jobId="${jobId}" templateId="${payload.templateId}" entityType="${payload.entityType}" entityId="${payload.entityId}"`
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
    console.error(`[DOCX:${docxRequestId}] enqueue failed`, message);
    return c.json({ message: 'Failed to enqueue DOCX generation.', error: message }, 422);
  }
});

docxRouter.get('/docx/jobs/:id/download', async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const jobId = c.req.param('id');

  const job = await queueManager.getJobStatus(jobId, { includeBinaryResult: true });
  if (!job || (job.workspaceId && job.workspaceId !== user.workspaceId)) {
    return c.json({ message: 'Job not found' }, 404);
  }

  if (job.type !== 'docx_generate') {
    return c.json({ message: 'Invalid job type for DOCX download' }, 400);
  }

  if (job.status === 'pending' || job.status === 'processing') {
    return c.json({ message: 'DOCX generation is still running' }, 409);
  }

  if (job.status === 'failed') {
    return c.json(
      {
        message: 'DOCX generation failed',
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
    // Backward compatibility for already completed jobs generated before S3 storage.
    buffer = Buffer.from(result.contentBase64, 'base64');
  }

  if (!buffer) {
    return c.json({ message: 'DOCX content missing in job result' }, 500);
  }
  c.header(
    'Content-Type',
    result.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  c.header('Content-Disposition', `attachment; filename="${result.fileName || `docx-${jobId}.docx`}"`);
  return c.body(new Uint8Array(buffer));
});
