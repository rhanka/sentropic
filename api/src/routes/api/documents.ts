import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { contextDocuments, contextModificationHistory, jobQueue } from '../../db/schema';
import { resolveReadableWorkspaceId } from '../../utils/workspace-scope';
import { createId } from '../../utils/id';
import { deleteObject, getDocumentsBucketName, getObjectBodyStream, putObject } from '../../services/storage-s3';
import { queueManager } from '../../services/queue-manager';

export const documentsRouter = new Hono();

const contextTypeSchema = z.enum(['organization', 'folder', 'usecase']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getDataString(data: unknown, key: string): string | null {
  const rec = asRecord(data);
  const v = rec[key];
  return typeof v === 'string' ? v : null;
}

const listQuerySchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
  workspace_id: z.string().optional(),
});

documentsRouter.get('/', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const parsed = listQuerySchema.safeParse({
    context_type: c.req.query('context_type'),
    context_id: c.req.query('context_id'),
    workspace_id: c.req.query('workspace_id'),
  });
  if (!parsed.success) return c.json({ message: 'Invalid query' }, 400);

  let targetWorkspaceId = user.workspaceId;
  try {
    targetWorkspaceId = await resolveReadableWorkspaceId({ user, requested: parsed.data.workspace_id });
  } catch {
    return c.json({ message: 'Not found' }, 404);
  }

  const rows = await db
    .select()
    .from(contextDocuments)
    .where(
      and(
        eq(contextDocuments.workspaceId, targetWorkspaceId),
        eq(contextDocuments.contextType, parsed.data.context_type),
        eq(contextDocuments.contextId, parsed.data.context_id)
      )
    )
    .orderBy(desc(contextDocuments.createdAt));

  // Heal/override document status from the linked job when the row is stale:
  // - if document is still `uploaded|processing` but job is `failed`, expose `failed` so UI can render it.
  // This can happen for historical rows created before we guaranteed failure propagation.
  const jobIds = rows.map((r) => r.jobId).filter((v): v is string => typeof v === 'string' && v.length > 0);
  const jobById = new Map<string, { status: string | null; error: string | null }>();
  if (jobIds.length > 0) {
    const jobRows = await db
      .select({ id: jobQueue.id, status: jobQueue.status, error: jobQueue.error })
      .from(jobQueue)
      .where(and(eq(jobQueue.workspaceId, targetWorkspaceId), inArray(jobQueue.id, jobIds)));
    for (const j of jobRows) {
      jobById.set(j.id, { status: j.status ?? null, error: j.error ?? null });
    }
  }

  const idsToMarkFailed: string[] = [];
  for (const r of rows) {
    if ((r.status === 'uploaded' || r.status === 'processing') && r.jobId) {
      const j = jobById.get(r.jobId);
      if (j?.status === 'failed') idsToMarkFailed.push(r.id);
    }
  }
  if (idsToMarkFailed.length > 0) {
    // Best-effort persist (so subsequent reads and tools see consistent status).
    // Do not touch summaries here; the queue worker already writes a failure message when possible.
    try {
      await db
        .update(contextDocuments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(contextDocuments.workspaceId, targetWorkspaceId), inArray(contextDocuments.id, idsToMarkFailed)));
    } catch {
      // ignore
    }
  }

  return c.json({
    items: rows.map((r) => ({
      // Override status for response if job has failed (even if DB heal failed).
      status:
        (r.status === 'uploaded' || r.status === 'processing') && r.jobId && jobById.get(r.jobId)?.status === 'failed'
          ? 'failed'
          : r.status,
      id: r.id,
      context_type: r.contextType,
      context_id: r.contextId,
      filename: r.filename,
      mime_type: r.mimeType,
      size_bytes: r.sizeBytes,
      summary: getDataString(r.data, 'summary'),
      summary_lang: getDataString(r.data, 'summaryLang'),
      job_id: r.jobId,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })),
  });
});

documentsRouter.get('/:id', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  let targetWorkspaceId = user.workspaceId;
  try {
    targetWorkspaceId = await resolveReadableWorkspaceId({ user, requested: c.req.query('workspace_id') });
  } catch {
    return c.json({ message: 'Not found' }, 404);
  }

  const id = c.req.param('id');
  const [doc] = await db
    .select()
    .from(contextDocuments)
    .where(and(eq(contextDocuments.id, id), eq(contextDocuments.workspaceId, targetWorkspaceId)))
    .limit(1);

  if (!doc) return c.json({ message: 'Not found' }, 404);

  return c.json({
    id: doc.id,
    context_type: doc.contextType,
    context_id: doc.contextId,
    filename: doc.filename,
    mime_type: doc.mimeType,
    size_bytes: doc.sizeBytes,
    storage_key: doc.storageKey,
    status: doc.status,
    summary: getDataString(doc.data, 'summary'),
    summary_lang: getDataString(doc.data, 'summaryLang'),
    job_id: doc.jobId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  });
});

documentsRouter.get('/:id/content', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  let targetWorkspaceId = user.workspaceId;
  try {
    targetWorkspaceId = await resolveReadableWorkspaceId({ user, requested: c.req.query('workspace_id') });
  } catch {
    return c.json({ message: 'Not found' }, 404);
  }

  const id = c.req.param('id');
  const [doc] = await db
    .select()
    .from(contextDocuments)
    .where(and(eq(contextDocuments.id, id), eq(contextDocuments.workspaceId, targetWorkspaceId)))
    .limit(1);
  if (!doc) return c.json({ message: 'Not found' }, 404);

  const bucket = getDocumentsBucketName();
  const stream = await getObjectBodyStream({ bucket, key: doc.storageKey });

  c.header('Content-Type', doc.mimeType || 'application/octet-stream');
  c.header('Content-Disposition', `attachment; filename="${doc.filename.replace(/"/g, '')}"`);
  return c.newResponse(stream, 200);
});

documentsRouter.delete('/:id', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  // Delete is write-scoped: only within user's own workspace for now.
  const workspaceId = user.workspaceId;

  const id = c.req.param('id');
  const [doc] = await db
    .select()
    .from(contextDocuments)
    .where(and(eq(contextDocuments.id, id), eq(contextDocuments.workspaceId, workspaceId)))
    .limit(1);
  if (!doc) return c.json({ message: 'Not found' }, 404);

  // Delete object (best-effort) then DB record.
  try {
    const bucket = getDocumentsBucketName();
    await deleteObject({ bucket, key: doc.storageKey });
  } catch {
    // ignore: S3 object may already be missing
  }

  await db
    .delete(contextDocuments)
    .where(and(eq(contextDocuments.id, id), eq(contextDocuments.workspaceId, workspaceId)));

  // History: document_deleted
  const seq = await getNextModificationSequence(doc.contextType, doc.contextId);
  await db.insert(contextModificationHistory).values({
    id: createId(),
    contextType: doc.contextType,
    contextId: doc.contextId,
    sessionId: null,
    messageId: null,
    field: 'document_deleted',
    oldValue: { documentId: doc.id, filename: doc.filename, storageKey: doc.storageKey },
    newValue: null,
    toolCallId: null,
    promptId: null,
    promptType: null,
    promptVersionId: null,
    jobId: doc.jobId ?? null,
    sequence: seq,
    createdAt: new Date(),
  });

  return c.body(null, 204);
});

const uploadFormSchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
});

async function getNextModificationSequence(contextType: string, contextId: string): Promise<number> {
  const result = await db
    .select({ maxSequence: sql<number>`MAX(${contextModificationHistory.sequence})` })
    .from(contextModificationHistory)
    .where(and(eq(contextModificationHistory.contextType, contextType), eq(contextModificationHistory.contextId, contextId)));
  const maxSequence = result[0]?.maxSequence ?? 0;
  return maxSequence + 1;
}

documentsRouter.post('/', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };

  const form = await c.req.raw.formData();
  const rawContextType = form.get('context_type');
  const rawContextId = form.get('context_id');

  const parsed = uploadFormSchema.safeParse({
    context_type: typeof rawContextType === 'string' ? rawContextType : '',
    context_id: typeof rawContextId === 'string' ? rawContextId : '',
  });
  if (!parsed.success) return c.json({ message: 'Invalid form fields' }, 400);

  const file = form.get('file');

    if (!(file instanceof File)) {
      return c.json({ message: 'Missing file' }, 400);
    }

    const maxBytes = 25 * 1024 * 1024;
    if (file.size > maxBytes) return c.json({ message: 'File too large' }, 413);

    const docId = createId();
    const safeName = (file.name || 'document').replace(/[^\w.\- ()]/g, '_');
    const storageKey = `documents/${workspaceId}/${parsed.data.context_type}/${parsed.data.context_id}/${docId}-${safeName}`;

    const bucket = getDocumentsBucketName();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await putObject({
      bucket,
      key: storageKey,
      body: bytes,
      contentType: file.type || 'application/octet-stream',
    });

    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: parsed.data.context_type,
      contextId: parsed.data.context_id,
      filename: safeName,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      storageKey,
      status: 'uploaded',
      data: { summaryLang: 'fr' },
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    // History: document_added
    const seq = await getNextModificationSequence(parsed.data.context_type, parsed.data.context_id);
    await db.insert(contextModificationHistory).values({
      id: createId(),
      contextType: parsed.data.context_type,
      contextId: parsed.data.context_id,
      sessionId: null,
      messageId: null,
      field: 'document_added',
      oldValue: null,
      newValue: {
        documentId: docId,
        filename: safeName,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        storageKey,
      },
      toolCallId: null,
      promptId: null,
      promptType: null,
      promptVersionId: null,
      jobId: null,
      sequence: seq,
      createdAt: new Date(),
    });

    // Enqueue summarization job (async)
    const jobId = await queueManager.addJob('document_summary', { documentId: docId, lang: 'fr' }, { workspaceId });
    await db
      .update(contextDocuments)
      .set({ jobId, updatedAt: new Date() })
      .where(and(eq(contextDocuments.id, docId), eq(contextDocuments.workspaceId, workspaceId)));

    return c.json(
      {
        id: docId,
        context_type: parsed.data.context_type,
        context_id: parsed.data.context_id,
        filename: safeName,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        storage_key: storageKey,
        status: 'uploaded',
        job_id: jobId,
      },
      201
    );
});


