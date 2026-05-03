import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { chatSessions, contextDocuments, contextModificationHistory, jobQueue } from '../../db/schema';
import { createId } from '../../utils/id';
import { deleteObject, getDocumentsBucketName, getObjectBodyStream, putObject } from '../../services/storage-s3';
import { queueManager } from '../../services/queue-manager';
import {
  buildGoogleDriveSourceData,
  loadContextDocumentContent,
  readContextDocumentSyncData,
  resolveContextDocumentSource,
  updateContextDocumentSyncData,
} from '../../services/context-document-source';
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

function sanitizeDocumentName(name: string | null | undefined): string {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return (normalized || 'document').replace(/[^\w.\- ()]/g, '_');
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

function getGoogleDriveFileSize(file: { size: string | null }): number {
  const parsed = file.size ? Number.parseInt(file.size, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getVisibleDocumentFields(doc: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sourceType: string | null;
  data: unknown;
}): { filename: string; mimeType: string; sizeBytes: number } {
  if (doc.sourceType !== 'google_drive') {
    return {
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
    };
  }

  const source = asRecord(asRecord(doc.data).source);
  const sourceName = sanitizeDocumentName(getDataString(source, 'name') ?? doc.filename);
  const sourceMimeType =
    getDataString(source, 'mimeType') ?? getDataString(source, 'mime_type') ?? doc.mimeType;
  const sourceSize = getDataString(source, 'size');
  const parsedSourceSize = sourceSize ? Number.parseInt(sourceSize, 10) : Number.NaN;

  return {
    filename: sourceName,
    mimeType: sourceMimeType,
    sizeBytes: Number.isFinite(parsedSourceSize) && parsedSourceSize >= 0 ? parsedSourceSize : doc.sizeBytes,
  };
}

function buildDocumentResponse(input: {
  doc: typeof contextDocuments.$inferSelect;
  status?: string;
  jobId?: string | null;
}) {
  const sync = readContextDocumentSyncData(input.doc.data);
  const visible = getVisibleDocumentFields(input.doc);
  return {
    id: input.doc.id,
    source_type: input.doc.sourceType,
    context_type: input.doc.contextType,
    context_id: input.doc.contextId,
    filename: visible.filename,
    mime_type: visible.mimeType,
    size_bytes: visible.sizeBytes,
    storage_key: input.doc.storageKey,
    status: input.status ?? (isDownloadOnlyDocument(input.doc) ? 'ready' : input.doc.status),
    sync_status: sync.syncStatus,
    last_synced_at: sync.lastSyncedAt,
    last_sync_error: sync.lastSyncError,
    summary: getDataString(input.doc.data, 'summary'),
    summary_lang: getDataString(input.doc.data, 'summaryLang'),
    indexing_skipped: getDataBoolean(input.doc.data, 'indexingSkipped'),
    job_id: input.jobId ?? input.doc.jobId,
    created_at: input.doc.createdAt,
    updated_at: input.doc.updatedAt,
  };
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
    items: rows.map((r) =>
      buildDocumentResponse({
        doc: r,
        status:
          isDownloadOnlyDocument(r)
            ? 'ready'
            : (r.status === 'uploaded' || r.status === 'processing') &&
                r.jobId &&
                jobById.get(r.jobId)?.status === 'failed'
            ? 'failed'
            : r.status,
      }),
    ),
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

  return c.json(buildDocumentResponse({ doc }));
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

  try {
    const access =
      doc.sourceType === 'google_drive'
        ? { mode: 'user' as const, userId: user.userId, workspaceId: targetWorkspaceId }
        : undefined;
    const loaded = await loadContextDocumentContent({ document: doc, access, purpose: 'download' });
    c.header('Content-Type', loaded.mimeType || 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${loaded.filename.replace(/"/g, '')}"`);
    return c.newResponse(loaded.bytes, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load document content';
    if (
      message === 'Google Drive account is not connected' ||
      message === 'Google Drive connector account is not connected'
    ) {
      return c.json({ message: 'Google Drive account is not connected' }, 409);
    }
    throw error;
  }
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

documentsRouter.post('/:id/resync', requireWorkspaceAccessRole(), async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string; userId: string };
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

  const lang = getDataString(doc.data, 'summaryLang') || 'fr';
  let nextFilename = doc.filename;
  let nextMimeType = doc.mimeType;
  let nextSizeBytes = doc.sizeBytes;
  let nextData = updateContextDocumentSyncData({
    data: doc.data,
    syncStatus: null,
    lastSyncError: null,
  });

  if (doc.sourceType === 'google_drive') {
    let source;
    try {
      source = resolveContextDocumentSource(doc);
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : 'Invalid Google Drive document source' }, 400);
    }
    if (source.kind !== 'google_drive') {
      return c.json({ message: 'Invalid Google Drive document source' }, 400);
    }

    const [account, token] = await Promise.all([
      getGoogleDriveConnectorAccount({ userId: user.userId, workspaceId }),
      resolveGoogleDriveTokenSecret({ userId: user.userId, workspaceId }),
    ]);
    if (!account || account.status !== 'connected' || !token?.accessToken) {
      return c.json({ message: 'Google Drive account is not connected' }, 409);
    }

    const file = await resolveGoogleDriveFileMetadata({
      accessToken: token.accessToken,
      fileId: source.fileId,
    });
    if (file.trashed || !isSupportedGoogleDriveMimeType(file.mimeType)) {
      return c.json({ message: 'Google Drive file is not supported for indexing' }, 400);
    }

    const exportMimeType = pickGoogleDriveExportMimeType(file.mimeType);
    nextFilename = sanitizeDocumentName(file.name);
    nextMimeType = file.mimeType;
    nextSizeBytes = getGoogleDriveFileSize(file);
    nextData = updateContextDocumentSyncData({
      data: doc.data,
      syncStatus: 'pending',
      lastSyncError: null,
      source: buildGoogleDriveSourceData({
        connectorAccountId: account.id,
        file,
        exportMimeType,
      }),
    });
  }

  const jobId = await queueManager.addJob('document_summary', { documentId: doc.id, lang }, { workspaceId });
  const now = new Date();

  await db
    .update(contextDocuments)
    .set({
      filename: nextFilename,
      mimeType: nextMimeType,
      sizeBytes: nextSizeBytes,
      status: 'uploaded',
      data: nextData,
      jobId,
      updatedAt: now,
    })
    .where(and(eq(contextDocuments.id, doc.id), eq(contextDocuments.workspaceId, workspaceId)));

  return c.json(
    buildDocumentResponse({
      doc: {
        ...doc,
        filename: nextFilename,
        mimeType: nextMimeType,
        sizeBytes: nextSizeBytes,
        status: 'uploaded',
        data: nextData,
        jobId,
        updatedAt: now,
      },
      jobId,
    }),
    202,
  );
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
    const mimeType = file.mimeType;
    const safeName = sanitizeDocumentName(file.name);
    const sizeBytes = getGoogleDriveFileSize(file);

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
        syncStatus: 'pending',
        source: buildGoogleDriveSourceData({
          connectorAccountId: account.id,
          file,
          exportMimeType,
        }),
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
