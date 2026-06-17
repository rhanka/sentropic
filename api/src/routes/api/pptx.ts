/**
 * PPTX generation download routes.
 *
 * In BR-21a, PPTX generation is persisted as completed `pptx_generate` jobs.
 *
 * Endpoints:
 * - POST /pptx/generate
 * - GET /pptx/jobs/:id/download
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { queueManager } from '../../services/queue-manager';
import { generateFreeformPptx, PPTX_MIME } from '../../services/pptx-generation';
import { getDocumentsBucketName, getObjectBytes, putObject } from '../../services/storage-s3';
import { createId } from '../../utils/id';

const generatePptxSchema = z.object({
  entityType: z.enum(['organization', 'folder', 'initiative']),
  entityId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
});

export const pptxRouter = new Hono();

pptxRouter.post('/pptx/generate', zValidator('json', generatePptxSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const pptxRequestId = randomUUID().slice(0, 8);
  const title = payload.title?.trim() || 'Generated presentation';
  const code = `
    const presentation = pptx({ title: ${JSON.stringify(title)} });
    titleSlide(
      presentation,
      ${JSON.stringify(title)},
      String(context.entity && context.entity.name ? context.entity.name : ${JSON.stringify(payload.entityType)})
    );
    return { presentation, fileName: ${JSON.stringify(title)} };
  `;

  try {
    const freeformResult = await generateFreeformPptx({
      code,
      entityType: payload.entityType,
      entityId: payload.entityId,
      workspaceId: user.workspaceId,
      title,
    });

    const jobId = createId();
    const bucket = getDocumentsBucketName();
    const objectKey = `pptx-cache/${user.workspaceId}/direct/${payload.entityType}/${payload.entityId}/${jobId}.pptx`;

    await putObject({
      bucket,
      key: objectKey,
      body: freeformResult.buffer,
      contentType: freeformResult.mimeType,
    });

    const completedAt = new Date().toISOString();
    const completedPayload = {
      state: 'done',
      progress: 100,
      fileName: freeformResult.fileName,
      mimeType: freeformResult.mimeType,
      byteLength: freeformResult.buffer.byteLength,
      storageBucket: bucket,
      storageKey: objectKey,
      queueClass: 'publishing',
      completedAt,
      requestId: pptxRequestId,
    };

    await db.run(sql`
      INSERT INTO job_queue (id, type, status, workspace_id, data, result, completed_at)
      VALUES (
        ${jobId},
        'pptx_generate',
        'completed',
        ${user.workspaceId},
        ${JSON.stringify({ entityType: payload.entityType, entityId: payload.entityId, mode: 'direct', format: 'pptx' })},
        ${JSON.stringify(completedPayload)},
        ${completedAt}
      )
    `);

    return c.json(
      {
        success: true,
        jobId,
        status: 'completed',
        queueClass: 'publishing',
        streamId: `job_${jobId}`,
      },
      200
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith('not_found:') ? 404 : 422;
    console.error(`[PPTX:${pptxRequestId}] generation failed`, message);
    return c.json({ message: 'Failed to generate PPTX.', error: message }, status);
  }
});

pptxRouter.get('/pptx/jobs/:id/download', async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const jobId = c.req.param('id');

  const job = await queueManager.getJobStatus(jobId, { includeBinaryResult: true });
  if (!job || (job.workspaceId && job.workspaceId !== user.workspaceId)) {
    return c.json({ message: 'Job not found' }, 404);
  }

  // queueManager.getJobStatus currently types job.type as JobType (which doesn't include pptx_generate yet).
  // Treat it as a string here so BR-21a can ship the download route without broad queue-manager changes.
  if (String(job.type) !== 'pptx_generate') {
    return c.json({ message: 'Invalid job type for PPTX download' }, 400);
  }

  if (job.status === 'pending' || job.status === 'processing') {
    return c.json({ message: 'PPTX generation is still running' }, 409);
  }

  if (job.status === 'failed') {
    return c.json(
      {
        message: 'PPTX generation failed',
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
    return c.json({ message: 'PPTX content missing in job result' }, 500);
  }

  c.header(
    'Content-Type',
    result.mimeType || PPTX_MIME
  );
  c.header('Content-Disposition', `attachment; filename="${result.fileName || `pptx-${jobId}.pptx`}"`);
  return c.body(new Uint8Array(buffer));
});
