import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { chatSessions, contextDocuments, contextModificationHistory, jobQueue } from '../../db/schema';
import { createId } from '../../utils/id';
import { deleteObject, getDocumentsBucketName, getObjectBodyStream, putObject } from '../../services/storage-s3';
import { queueManager } from '../../services/queue-manager';
import { loadContextDocumentContent } from '../../services/context-document-source';
import { requireWorkspaceAccessRole } from '../../middleware/workspace-rbac';
import { requireWorkspaceEditor } from '../../services/workspace-access';
import { getGoogleDriveConnectorAccount, resolveGoogleDriveTokenSecret } from '../../services/google-drive-connector-accounts';
import { isSupportedGoogleDriveMimeType, pickGoogleDriveExportMimeType, resolveGoogleDriveFileMetadata } from '../../services/google-drive-client';

export const documentsRouter = new Hono();

const contextTypeSchema = z.enum(['organization', 'folder', 'initiative', 'usecase', 'chat_session']); // TODO Lot 10: remove 'usecase'

const DOWNLOAD_ONLY_ARCHIVE_REASON = 'archive_download_only';
const ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
]);
const GZIP_MIME_TYPES = new Set([
  'application/gzip',
  'application/x-gzip',
]);
const TAR_MIME_TYPES = new Set([
  'application/tar',
  'application/x-tar',
  'application/x-gtar',
]);
const MAX_DOCUMENT_UPLOAD_BYTES = 100 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getDataString(data: unknown, key: string): string | null {
  const rec = asRecord(data);
  const v = rec[key];
  return typeof v === 'string' ? v : null;
}

function getDataBoolean(data: unknown, key: string): boolean {
  const rec = asRecord(data);
  return rec[key] === true;
}

function normalizeDocumentMimeType(fileName: string, rawMimeType: string | null | undefined): string {
  const lowerName = fileName.trim().toLowerCase();
  const mime = (rawMimeType || '').trim().toLowerCase();

  if (lowerName.endsWith('.zip')) return 'application/zip';
  if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) return 'application/gzip';
  if (lowerName.endsWith('.tar')) return 'application/x-tar';

  return mime || 'application/octet-stream';
}

function isDownloadOnlyArchive(fileName: string, mimeType: string): boolean {
  const lowerName = fileName.trim().toLowerCase();
  const lowerMime = mimeType.trim().toLowerCase();

  if (lowerName.endsWith('.zip') || lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) {
    return true;
  }
  if (ZIP_MIME_TYPES.has(lowerMime)) return true;
  if (GZIP_MIME_TYPES.has(lowerMime)) return true;
  if (TAR_MIME_TYPES.has(lowerMime)) return true;
  return false;
}

function isDownloadOnlyDocument(doc: { filename: string; mimeType: string; data: unknown }): boolean {
  return getDataBoolean(doc.data, 'indexingSkipped') || isDownloadOnlyArchive(doc.filename, doc.mimeType);
}

const listQuerySchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
  workspace_id: z.string().optional(),
});

async function ensureChatSessionAccess(opts: { sessionId: string; userId: string }): Promise<boolean> {
  const [row] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, opts.sessionId), eq(chatSessions.userId, opts.userId)))
    .limit(1);
  return !!row;
}

documentsRouter.get('/', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string; userId: string };
  const parsed = listQuerySchema.safeParse({
    context_type: c.req.query('context_type'),
    context_id: c.req.query('context_id'),
    workspace_id: c.req.query('workspace_id'),
  });
  if (!parsed.success) return c.json({ message: 'Invalid query' }, 400);

  const targetWorkspaceId = user.workspaceId;
  if (parsed.data.context_type === 'chat_session') {
    const ok = await ensureChatSessionAccess({ sessionId: parsed.data.context_id, userId: user.userId });
    if (!ok) return c.json({ message: 'Not found' }, 404);
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

  const idsToMarkReady: string[] = [];
  const idsToMarkFailed: string[] = [];
  for (const r of rows) {
    if (isDownloadOnlyDocument(r)) {
      if (r.status !== 'ready') idsToMarkReady.push(r.id);
      continue;
    }
    if ((r.status === 'uploaded' || r.status === 'processing') && r.jobId) {
      const j = jobById.get(r.jobId);
      if (j?.status === 'failed') idsToMarkFailed.push(r.id);
    }
  }
  if (idsToMarkReady.length > 0) {
    try {
      await db
        .update(contextDocuments)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(and(eq(contextDocuments.workspaceId, targetWorkspaceId), inArray(contextDocuments.id, idsToMarkReady)));
    } catch {
      // ignore
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
      // Download-only archives are always effectively ready, even for legacy rows
      // that were persisted before archive indexing was skipped.
      status:
        isDownloadOnlyDocument(r)
          ? 'ready'
          : (r.status === 'uploaded' || r.status === 'processing') &&
              r.jobId &&
              jobById.get(r.jobId)?.status === 'failed'
          ? 'failed'
          : r.status,
      id: r.id,
      source_type: r.sourceType,
      context_type: r.contextType,
      context_id: r.contextId,
      filename: r.filename,
      mime_type: r.mimeType,
      size_bytes: r.sizeBytes,
      summary: getDataString(r.data, 'summary'),
      summary_lang: getDataString(r.data, 'summaryLang'),
      indexing_skipped: getDataBoolean(r.data, 'indexingSkipped'),
      job_id: r.jobId,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })),
  });
});

documentsRouter.get('/:id', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string; userId: string };
  const targetWorkspaceId = user.workspaceId;

  const id = c.req.param('id')!;
  const [doc] = await db
    .select()
    .from(contextDocuments)
    .where(and(eq(contextDocuments.id, id), eq(contextDocuments.workspaceId, targetWorkspaceId)))
    .limit(1);

  if (!doc) return c.json({ message: 'Not found' }, 404);
  if (doc.contextType === 'chat_session') {
    const ok = await ensureChatSessionAccess({ sessionId: doc.contextId, userId: user.userId });
    if (!ok) return c.json({ message: 'Not found' }, 404);
  }

  return c.json({
    id: doc.id,
    source_type: doc.sourceType,
    context_type: doc.contextType,
    context_id: doc.contextId,
    filename: doc.filename,
    mime_type: doc.mimeType,
    size_bytes: doc.sizeBytes,
    storage_key: doc.storageKey,
    status: isDownloadOnlyDocument(doc) ? 'ready' : doc.status,
    summary: getDataString(doc.data, 'summary'),
    summary_lang: getDataString(doc.data, 'summaryLang'),
    indexing_skipped: getDataBoolean(doc.data, 'indexingSkipped'),
    job_id: doc.jobId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  });
});

documentsRouter.get('/:id/content', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string; userId: string };
  const targetWorkspaceId = user.workspaceId;

  const id = c.req.param('id')!;
  const [doc] = await db
    .select()
    .from(contextDocuments)
    .where(and(eq(contextDocuments.id, id), eq(contextDocuments.workspaceId, targetWorkspaceId)))
    .limit(1);
  if (!doc) return c.json({ message: 'Not found' }, 404);
  if (doc.contextType === 'chat_session') {
    const ok = await ensureChatSessionAccess({ sessionId: doc.contextId, userId: user.userId });
    if (!ok) return c.json({ message: 'Not found' }, 404);
  }

  if (doc.sourceType === 'local' && doc.storageKey) {
    const bucket = getDocumentsBucketName();
    const stream = await getObjectBodyStream({ bucket, key: doc.storageKey });

    c.header('Content-Type', doc.mimeType || 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${doc.filename.replace(/"/g, '')}"`);
    return c.newResponse(stream, 200);
  }

  const loaded = await loadContextDocumentContent({ document: doc });
  c.header('Content-Type', loaded.mimeType || 'application/octet-stream');
  c.header('Content-Disposition', `attachment; filename="${loaded.filename.replace(/"/g, '')}"`);
  return c.newResponse(loaded.bytes, 200);
});

documentsRouter.delete('/:id', requireWorkspaceAccessRole(), async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string; userId: string };
  // Delete is write-scoped: only within user's own workspace for now.
  const workspaceId = user.workspaceId;

  const id = c.req.param('id')!;
  const [doc] = await db
    .select()
    .from(contextDocuments)
    .where(and(eq(contextDocuments.id, id), eq(contextDocuments.workspaceId, workspaceId)))
    .limit(1);
  if (!doc) return c.json({ message: 'Not found' }, 404);
  if (doc.contextType === 'chat_session') {
    const ok = await ensureChatSessionAccess({ sessionId: doc.contextId, userId: user.userId });
    if (!ok) return c.json({ message: 'Not found' }, 404);
  } else {
    try {
      await requireWorkspaceEditor(user.userId, workspaceId);
    } catch {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }
  }

  // Delete object (best-effort) then DB record.
  if (doc.sourceType === 'local' && doc.storageKey) {
    try {
      const bucket = getDocumentsBucketName();
      await deleteObject({ bucket, key: doc.storageKey });
    } catch {
      // ignore: S3 object may already be missing
    }
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

documentsRouter.post('/', requireWorkspaceAccessRole(), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };

  const form = await c.req.raw.formData();
  const rawContextType = form.get('context_type');
  const rawContextId = form.get('context_id');

  const parsed = uploadFormSchema.safeParse({
    context_type: typeof rawContextType === 'string' ? rawContextType : '',
    context_id: typeof rawContextId === 'string' ? rawContextId : '',
  });
  if (!parsed.success) return c.json({ message: 'Invalid form fields' }, 400);
  if (parsed.data.context_type === 'chat_session') {
    const ok = await ensureChatSessionAccess({ sessionId: parsed.data.context_id, userId });
    if (!ok) return c.json({ message: 'Not found' }, 404);
  } else {
    try {
      await requireWorkspaceEditor(userId, workspaceId);
    } catch {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }
  }

  const file = form.get('file');

    if (!(file instanceof File)) {
      return c.json({ message: 'Missing file' }, 400);
    }

    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) return c.json({ message: 'File too large' }, 413);

    const docId = createId();
    const safeName = (file.name || 'document').replace(/[^\w.\- ()]/g, '_');
    const storageKey = `documents/${workspaceId}/${parsed.data.context_type}/${parsed.data.context_id}/${docId}-${safeName}`;

    const bucket = getDocumentsBucketName();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = normalizeDocumentMimeType(safeName, file.type);
    const indexingSkipped = isDownloadOnlyArchive(safeName, mimeType);

    await putObject({
      bucket,
      key: storageKey,
      body: bytes,
      contentType: mimeType,
    });

    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: parsed.data.context_type,
      contextId: parsed.data.context_id,
      filename: safeName,
      mimeType,
      sizeBytes: file.size,
      sourceType: 'local',
      storageKey,
      status: indexingSkipped ? 'ready' : 'uploaded',
      data: indexingSkipped
        ? {
            summaryLang: 'fr',
            indexingSkipped: true,
            indexingSkipReason: DOWNLOAD_ONLY_ARCHIVE_REASON,
          }
        : { summaryLang: 'fr' },
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
        mimeType,
        sizeBytes: file.size,
        storageKey,
        indexingSkipped,
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
    let jobId: string | null = null;
    if (!indexingSkipped) {
      jobId = await queueManager.addJob('document_summary', { documentId: docId, lang: 'fr' }, { workspaceId });
      await db
        .update(contextDocuments)
        .set({ jobId, updatedAt: new Date() })
        .where(and(eq(contextDocuments.id, docId), eq(contextDocuments.workspaceId, workspaceId)));
    }

    return c.json(
      {
        id: docId,
        context_type: parsed.data.context_type,
        context_id: parsed.data.context_id,
        filename: safeName,
        mime_type: mimeType,
        size_bytes: file.size,
        storage_key: storageKey,
        status: indexingSkipped ? 'ready' : 'uploaded',
        indexing_skipped: indexingSkipped,
        ...(jobId ? { job_id: jobId } : {}),
      },
      201
    );
});

const attachGoogleDriveSchema = z.object({
  context_type: contextTypeSchema,
  context_id: z.string().min(1),
  file_ids: z.array(z.string().trim().min(1)).min(1).max(20),
});

const extensionByExportMimeType: Record<string, string> = {
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

function withExportExtension(name: string, exportMimeType: string | null): string {
  const ext = exportMimeType ? extensionByExportMimeType[exportMimeType] : null;
  if (!ext) return name;
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

documentsRouter.post('/google-drive', requireWorkspaceAccessRole(), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const body = await c.req.json().catch(() => ({}));
  const parsed = attachGoogleDriveSchema.safeParse(body);
  if (!parsed.success) return c.json({ message: 'Invalid Google Drive attach request' }, 400);

  if (parsed.data.context_type === 'chat_session') {
    const ok = await ensureChatSessionAccess({ sessionId: parsed.data.context_id, userId });
    if (!ok) return c.json({ message: 'Not found' }, 404);
  } else {
    try {
      await requireWorkspaceEditor(userId, workspaceId);
    } catch {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }
  }

  const [account, token] = await Promise.all([
    getGoogleDriveConnectorAccount({ userId, workspaceId }),
    resolveGoogleDriveTokenSecret({ userId, workspaceId }),
  ]);
  if (!account || account.status !== 'connected' || !token?.accessToken) {
    return c.json({ message: 'Google Drive account is not connected' }, 409);
  }

  const resolved = [];
  for (const fileId of parsed.data.file_ids) {
    const file = await resolveGoogleDriveFileMetadata({ accessToken: token.accessToken, fileId });
    resolved.push(file);
  }

  const unsupported = resolved.filter((file) => !isSupportedGoogleDriveMimeType(file.mimeType) || file.trashed);
  if (unsupported.length > 0) {
    return c.json(
      {
        message: 'Some selected Google Drive files are not supported',
        unsupported: unsupported.map((f) => ({ id: f.id, name: f.name, mime_type: f.mimeType, trashed: f.trashed })),
      },
      400,
    );
  }

  const created: Array<Record<string, unknown>> = [];
  for (const file of resolved) {
    const exportMimeType = pickGoogleDriveExportMimeType(file.mimeType);
    const mimeType = exportMimeType ?? file.mimeType;
    const safeName = withExportExtension((file.name || 'document').replace(/[^\w.\- ()]/g, '_'), exportMimeType);
    const sizeBytes = (() => {
      const parsed = file.size ? Number.parseInt(file.size, 10) : Number.NaN;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    })();

    const docId = createId();
    await db.insert(contextDocuments).values({
      id: docId,
      workspaceId,
      contextType: parsed.data.context_type,
      contextId: parsed.data.context_id,
      filename: safeName,
      mimeType,
      sizeBytes,
      sourceType: 'google_drive',
      storageKey: null,
      status: 'uploaded',
      data: {
        summaryLang: 'fr',
        source: {
          kind: 'google_drive',
          connectorAccountId: account.id,
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          exportMimeType,
          webViewLink: file.webViewLink,
          webContentLink: file.webContentLink,
          iconLink: file.iconLink,
          modifiedTime: file.modifiedTime,
          version: file.version,
          size: file.size,
          md5Checksum: file.md5Checksum,
          driveId: file.driveId,
        },
      },
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
        sourceType: 'google_drive',
        externalFileId: file.id,
        filename: safeName,
        mimeType,
        sizeBytes,
      },
      toolCallId: null,
      promptId: null,
      promptType: null,
      promptVersionId: null,
      jobId: null,
      sequence: seq,
      createdAt: new Date(),
    });

    const jobId = await queueManager.addJob('document_summary', { documentId: docId, lang: 'fr' }, { workspaceId });
    await db
      .update(contextDocuments)
      .set({ jobId, updatedAt: new Date() })
      .where(and(eq(contextDocuments.id, docId), eq(contextDocuments.workspaceId, workspaceId)));

    created.push({
      id: docId,
      source_type: 'google_drive',
      context_type: parsed.data.context_type,
      context_id: parsed.data.context_id,
      filename: safeName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      storage_key: null,
      status: 'uploaded',
      job_id: jobId,
    });
  }

  return c.json({ items: created }, 201);
});
