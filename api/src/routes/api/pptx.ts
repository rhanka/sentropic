/**
 * PPTX generation download routes.
 *
 * In BR-21a, PPTX generation is triggered by the chat tool `document_generate`
 * (freeform sandbox mode) and persisted as completed `pptx_generate` jobs.
 *
 * Download endpoint:
 * - GET /pptx/jobs/:id/download
 */

import { Hono } from 'hono';
import { queueManager } from '../../services/queue-manager';
import { getDocumentsBucketName, getObjectBytes } from '../../services/storage-s3';

export const pptxRouter = new Hono();

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
    result.mimeType ||
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  );
  c.header('Content-Disposition', `attachment; filename="${result.fileName || `pptx-${jobId}.pptx`}"`);
  return c.body(new Uint8Array(buffer));
});
