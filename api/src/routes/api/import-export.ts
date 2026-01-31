import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, inArray, or } from 'drizzle-orm';
import {
  comments,
  contextDocuments,
  folders,
  organizations,
  useCases,
  workspaceMemberships,
  workspaces,
} from '../../db/schema';
import { db } from '../../db/client';
import { createId } from '../../utils/id';
import { getDocumentsBucketName, getObjectBytes, putObject } from '../../services/storage-s3';
import { requireWorkspaceAdmin, requireWorkspaceEditor } from '../../services/workspace-access';

export const exportsRouter = new Hono();
export const importsRouter = new Hono();

const scopeSchema = z.enum(['workspace', 'folder', 'usecase', 'organization', 'matrix']);

const exportSchema = z.object({
  scope: scopeSchema,
  scope_id: z.string().optional(),
  include_comments: z.boolean().optional().default(true),
  include_documents: z.boolean().optional().default(true),
});

type ManifestFile = { path: string; bytes: number; sha256: string };

type ExportPayload = {
  workspaces: Array<Record<string, unknown>>;
  workspace_memberships: Array<Record<string, unknown>>;
  organizations: Array<Record<string, unknown>>;
  folders: Array<Record<string, unknown>>;
  use_cases: Array<Record<string, unknown>>;
  matrix: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function encodeJson(data: unknown): Uint8Array {
  const text = stableStringify(data);
  return new TextEncoder().encode(text);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDate(value: string | null | undefined): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function getSchemaVersionTag(): Promise<string> {
  try {
    const url = new URL('../../../drizzle/meta/_journal.json', import.meta.url);
    const raw = await readFile(url, 'utf-8');
    const parsed = JSON.parse(raw) as { entries?: Array<{ tag?: string }> };
    const tag = parsed.entries?.[parsed.entries.length - 1]?.tag;
    return typeof tag === 'string' && tag.length > 0 ? tag : 'unknown';
  } catch {
    return 'unknown';
  }
}

function ensureScopeId(scope: z.infer<typeof scopeSchema>, scopeId?: string | null): string | null {
  if (scope === 'workspace') return scopeId ?? null;
  if (!scopeId) return null;
  return scopeId;
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function mapOrganization(row: typeof organizations.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    status: row.status,
    data: row.data,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

function mapFolder(row: typeof folders.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    description: row.description,
    organization_id: row.organizationId,
    matrix_config: row.matrixConfig,
    executive_summary: row.executiveSummary,
    status: row.status,
    created_at: toIso(row.createdAt),
  };
}

function mapUseCase(row: typeof useCases.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    folder_id: row.folderId,
    organization_id: row.organizationId,
    status: row.status,
    model: row.model,
    data: row.data,
    created_at: toIso(row.createdAt),
  };
}

function mapComment(row: typeof comments.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    context_type: row.contextType,
    context_id: row.contextId,
    section_key: row.sectionKey,
    created_by: row.createdBy,
    assigned_to: row.assignedTo,
    status: row.status,
    thread_id: row.threadId,
    content: row.content,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

async function collectExportData(opts: {
  workspaceId: string;
  scope: z.infer<typeof scopeSchema>;
  scopeId?: string | null;
  includeComments: boolean;
  includeDocuments: boolean;
}): Promise<{ payload: ExportPayload; documents: Array<typeof contextDocuments.$inferSelect> }> {
  const payload: ExportPayload = {
    workspaces: [],
    workspace_memberships: [],
    organizations: [],
    folders: [],
    use_cases: [],
    matrix: [],
    comments: [],
  };

  const documents: Array<typeof contextDocuments.$inferSelect> = [];

  if (opts.scope === 'workspace') {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, opts.workspaceId)).limit(1);
    if (ws) {
      payload.workspaces.push({
        id: ws.id,
        owner_user_id: ws.ownerUserId,
        name: ws.name,
        hidden_at: toIso(ws.hiddenAt),
        created_at: toIso(ws.createdAt),
        updated_at: toIso(ws.updatedAt),
      });
    }
    const memberships = await db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, opts.workspaceId));
    payload.workspace_memberships = memberships.map((m) => ({
      workspace_id: m.workspaceId,
      user_id: m.userId,
      role: m.role,
      created_at: toIso(m.createdAt),
    }));

    const orgRows = await db.select().from(organizations).where(eq(organizations.workspaceId, opts.workspaceId));
    const folderRows = await db.select().from(folders).where(eq(folders.workspaceId, opts.workspaceId));
    const useCaseRows = await db.select().from(useCases).where(eq(useCases.workspaceId, opts.workspaceId));

    payload.organizations = orgRows.map(mapOrganization);
    payload.folders = folderRows.map(mapFolder);
    payload.use_cases = useCaseRows.map(mapUseCase);
    payload.matrix = folderRows
      .filter((f) => typeof f.matrixConfig === 'string' && f.matrixConfig.length > 0)
      .map((f) => ({ folder_id: f.id, matrix_config: f.matrixConfig }));

    if (opts.includeComments) {
      const commentRows = await db.select().from(comments).where(eq(comments.workspaceId, opts.workspaceId));
      payload.comments = commentRows.map(mapComment);
    }
    if (opts.includeDocuments) {
      const docRows = await db
        .select()
        .from(contextDocuments)
        .where(
          and(
            eq(contextDocuments.workspaceId, opts.workspaceId),
            inArray(contextDocuments.contextType, ['organization', 'folder', 'usecase'])
          )
        );
      documents.push(...docRows);
    }
    return { payload, documents };
  }

  const scopeId = ensureScopeId(opts.scope, opts.scopeId);
  if (!scopeId) {
    return { payload, documents };
  }

  if (opts.scope === 'organization') {
    const [org] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, scopeId), eq(organizations.workspaceId, opts.workspaceId)))
      .limit(1);
    if (!org) return { payload, documents };
    payload.organizations = [mapOrganization(org)];

    const folderRows = await db
      .select()
      .from(folders)
      .where(and(eq(folders.workspaceId, opts.workspaceId), eq(folders.organizationId, scopeId)));
    payload.folders = folderRows.map(mapFolder);
    payload.matrix = folderRows
      .filter((f) => typeof f.matrixConfig === 'string' && f.matrixConfig.length > 0)
      .map((f) => ({ folder_id: f.id, matrix_config: f.matrixConfig }));

    const folderIds = folderRows.map((f) => f.id);
    const useCaseRows = folderIds.length
      ? await db
          .select()
          .from(useCases)
          .where(and(eq(useCases.workspaceId, opts.workspaceId), inArray(useCases.folderId, folderIds)))
      : [];
    payload.use_cases = useCaseRows.map(mapUseCase);

    if (opts.includeComments) {
      const useCaseIds = useCaseRows.map((u) => u.id);
      const commentFilters = [
        and(eq(comments.contextType, 'organization'), eq(comments.contextId, scopeId)),
      ];
      if (folderIds.length > 0) {
        commentFilters.push(and(eq(comments.contextType, 'folder'), inArray(comments.contextId, folderIds)));
      }
      if (useCaseIds.length > 0) {
        commentFilters.push(and(eq(comments.contextType, 'usecase'), inArray(comments.contextId, useCaseIds)));
      }
      const commentRows = await db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.workspaceId, opts.workspaceId),
            or(...commentFilters)
          )
        );
      payload.comments = commentRows.map(mapComment);
    }

    if (opts.includeDocuments) {
      const useCaseIds = useCaseRows.map((u) => u.id);
      const docFilters = [
        and(eq(contextDocuments.contextType, 'organization'), eq(contextDocuments.contextId, scopeId)),
      ];
      if (folderIds.length > 0) {
        docFilters.push(and(eq(contextDocuments.contextType, 'folder'), inArray(contextDocuments.contextId, folderIds)));
      }
      if (useCaseIds.length > 0) {
        docFilters.push(and(eq(contextDocuments.contextType, 'usecase'), inArray(contextDocuments.contextId, useCaseIds)));
      }
      const docRows = await db
        .select()
        .from(contextDocuments)
        .where(
          and(
            eq(contextDocuments.workspaceId, opts.workspaceId),
            or(...docFilters)
          )
        );
      documents.push(...docRows);
    }
    return { payload, documents };
  }

  if (opts.scope === 'folder' || opts.scope === 'matrix') {
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, scopeId), eq(folders.workspaceId, opts.workspaceId)))
      .limit(1);
    if (!folder) return { payload, documents };
    payload.folders = [mapFolder(folder)];
    if (typeof folder.matrixConfig === 'string' && folder.matrixConfig.length > 0) {
      payload.matrix = [{ folder_id: folder.id, matrix_config: folder.matrixConfig }];
    }

    if (opts.scope === 'folder') {
      const useCaseRows = await db
        .select()
        .from(useCases)
        .where(and(eq(useCases.workspaceId, opts.workspaceId), eq(useCases.folderId, scopeId)));
      payload.use_cases = useCaseRows.map(mapUseCase);

      if (opts.includeComments) {
        const useCaseIds = useCaseRows.map((u) => u.id);
        const commentFilters = [
          and(eq(comments.contextType, 'folder'), eq(comments.contextId, scopeId)),
        ];
        if (useCaseIds.length > 0) {
          commentFilters.push(and(eq(comments.contextType, 'usecase'), inArray(comments.contextId, useCaseIds)));
        }
        const commentRows = await db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.workspaceId, opts.workspaceId),
              or(...commentFilters)
            )
          );
        payload.comments = commentRows.map(mapComment);
      }

      if (opts.includeDocuments) {
        const useCaseIds = useCaseRows.map((u) => u.id);
        const docFilters = [
          and(eq(contextDocuments.contextType, 'folder'), eq(contextDocuments.contextId, scopeId)),
        ];
        if (useCaseIds.length > 0) {
          docFilters.push(and(eq(contextDocuments.contextType, 'usecase'), inArray(contextDocuments.contextId, useCaseIds)));
        }
        const docRows = await db
          .select()
          .from(contextDocuments)
          .where(
            and(
              eq(contextDocuments.workspaceId, opts.workspaceId),
              or(...docFilters)
            )
          );
        documents.push(...docRows);
      }
    }

    return { payload, documents };
  }

  if (opts.scope === 'usecase') {
    const [useCase] = await db
      .select()
      .from(useCases)
      .where(and(eq(useCases.id, scopeId), eq(useCases.workspaceId, opts.workspaceId)))
      .limit(1);
    if (!useCase) return { payload, documents };
    payload.use_cases = [mapUseCase(useCase)];

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, useCase.folderId), eq(folders.workspaceId, opts.workspaceId)))
      .limit(1);
    if (folder) {
      payload.folders = [mapFolder(folder)];
      if (typeof folder.matrixConfig === 'string' && folder.matrixConfig.length > 0) {
        payload.matrix = [{ folder_id: folder.id, matrix_config: folder.matrixConfig }];
      }
    }

    if (opts.includeComments) {
      const commentRows = await db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.workspaceId, opts.workspaceId),
            eq(comments.contextType, 'usecase'),
            eq(comments.contextId, scopeId)
          )
        );
      payload.comments = commentRows.map(mapComment);
    }

    if (opts.includeDocuments) {
      const docRows = await db
        .select()
        .from(contextDocuments)
        .where(
          and(
            eq(contextDocuments.workspaceId, opts.workspaceId),
            eq(contextDocuments.contextType, 'usecase'),
            eq(contextDocuments.contextId, scopeId)
          )
        );
      documents.push(...docRows);
    }

    return { payload, documents };
  }

  return { payload, documents };
}

exportsRouter.post('/', zValidator('json', exportSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const body = c.req.valid('json');
  const scopeId = ensureScopeId(body.scope, body.scope_id ?? null);
  if (body.scope !== 'workspace' && !scopeId) {
    return c.json({ message: 'scope_id is required for this scope' }, 400);
  }

  try {
    if (body.scope === 'workspace') {
      await requireWorkspaceAdmin(user.userId, user.workspaceId);
    } else {
      await requireWorkspaceEditor(user.userId, user.workspaceId);
    }
  } catch {
    return c.json({ message: 'Insufficient permissions' }, 403);
  }

  const { payload, documents } = await collectExportData({
    workspaceId: user.workspaceId,
    scope: body.scope,
    scopeId,
    includeComments: body.include_comments ?? true,
    includeDocuments: body.include_documents ?? true,
  });

  const zip = new JSZip();
  const manifestFiles: ManifestFile[] = [];

  const addZipFile = (path: string, bytes: Uint8Array) => {
    zip.file(path, bytes);
    manifestFiles.push({ path, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) });
  };

  if (payload.workspaces.length > 0) addZipFile('workspaces.json', encodeJson(payload.workspaces));
  if (payload.workspace_memberships.length > 0) {
    addZipFile('workspace_memberships.json', encodeJson(payload.workspace_memberships));
  }
  if (payload.organizations.length > 0) addZipFile('organizations.json', encodeJson(payload.organizations));
  if (payload.folders.length > 0) addZipFile('folders.json', encodeJson(payload.folders));
  if (payload.use_cases.length > 0) addZipFile('use_cases.json', encodeJson(payload.use_cases));
  if (payload.matrix.length > 0) addZipFile('matrix.json', encodeJson(payload.matrix));
  if (payload.comments.length > 0 && body.include_comments) {
    addZipFile('comments.json', encodeJson(payload.comments));
  }

  if (body.include_documents) {
    const bucket = getDocumentsBucketName();
    for (const doc of documents) {
      const filename = doc.filename.replace(/[^\w.\- ()]/g, '_');
      const path = `documents/${doc.workspaceId}/${doc.contextType}/${doc.contextId}/${doc.id}-${filename}`;
      const bytes = await getObjectBytes({ bucket, key: doc.storageKey });
      addZipFile(path, bytes);
    }
  }

  const meta = {
    title: 'Exported workspace data',
    notes: `Created by user ${user.userId}`,
    source: 'top-ai-ideas',
    warnings: [],
  };
  addZipFile('meta.json', encodeJson(meta));

  const manifestCore = {
    export_version: '1.0',
    schema_version: await getSchemaVersionTag(),
    created_at: new Date().toISOString(),
    scope: body.scope,
    scope_id: scopeId ?? null,
    include_comments: body.include_comments ?? true,
    include_documents: body.include_documents ?? true,
    files: manifestFiles.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
  };
  const manifestHash = sha256Bytes(encodeJson(manifestCore));
  const manifest = { ...manifestCore, manifest_hash: manifestHash };
  zip.file('manifest.json', encodeJson(manifest));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipBuffer = Buffer.from(zipBytes);
  const fileName = `export-${body.scope}${scopeId ? `-${scopeId}` : ''}-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:]/g, '-')}.zip`;
  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="${fileName}"`);
  return c.newResponse(zipBuffer, 200);
});

importsRouter.post('/', async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const form = await c.req.raw.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ message: 'Missing file' }, 400);
  }

  const targetWorkspaceIdRaw = form.get('target_workspace_id');
  const targetWorkspaceId =
    typeof targetWorkspaceIdRaw === 'string' && targetWorkspaceIdRaw.trim().length > 0
      ? targetWorkspaceIdRaw.trim()
      : null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return c.json({ message: 'Invalid zip file' }, 400);
  }

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) return c.json({ message: 'Missing manifest.json' }, 400);
  const manifestText = await manifestFile.async('string');
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText) as Record<string, unknown>;
  } catch {
    return c.json({ message: 'Invalid manifest.json' }, 400);
  }

  const manifestScope = scopeSchema.safeParse(manifest.scope);
  if (!manifestScope.success) return c.json({ message: 'Invalid scope' }, 400);
  const manifestFiles = Array.isArray(manifest.files) ? (manifest.files as ManifestFile[]) : [];

  const { manifest_hash, ...manifestCore } = manifest;
  const expectedHash = sha256Bytes(encodeJson(manifestCore));
  if (typeof manifest_hash !== 'string' || manifest_hash !== expectedHash) {
    return c.json({ message: 'Manifest hash mismatch' }, 400);
  }

  for (const entry of manifestFiles) {
    const fileEntry = zip.file(entry.path);
    if (!fileEntry) return c.json({ message: `Missing file ${entry.path}` }, 400);
    const fileBytes = await fileEntry.async('uint8array');
    if (sha256Bytes(fileBytes) !== entry.sha256) {
      return c.json({ message: `Hash mismatch for ${entry.path}` }, 400);
    }
  }

  if (manifestScope.data !== 'workspace' && !targetWorkspaceId) {
    return c.json({ message: 'target_workspace_id is required for object imports' }, 400);
  }

  if (targetWorkspaceId) {
    try {
      if (manifestScope.data === 'workspace') {
        await requireWorkspaceAdmin(user.userId, targetWorkspaceId);
      } else {
        await requireWorkspaceEditor(user.userId, targetWorkspaceId);
      }
    } catch {
      return c.json({ message: 'Insufficient permissions' }, 403);
    }
  }

  const readJsonArray = async (path: string): Promise<Array<Record<string, unknown>>> => {
    const entry = zip.file(path);
    if (!entry) return [];
    const text = await entry.async('string');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  };

  const workspacesJson = await readJsonArray('workspaces.json');
  const organizationsJson = await readJsonArray('organizations.json');
  const foldersJson = await readJsonArray('folders.json');
  const useCasesJson = await readJsonArray('use_cases.json');
  const commentsJson = await readJsonArray('comments.json');
  const matrixJson = await readJsonArray('matrix.json');

  const now = new Date();
  const idMap = {
    workspace: new Map<string, string>(),
    organization: new Map<string, string>(),
    folder: new Map<string, string>(),
    usecase: new Map<string, string>(),
    thread: new Map<string, string>(),
  };

  let resolvedWorkspaceId = targetWorkspaceId ?? null;
  if (!resolvedWorkspaceId) {
    const sourceWs = workspacesJson[0];
    const wsName =
      typeof sourceWs?.name === 'string' && sourceWs.name.trim().length > 0
        ? sourceWs.name.trim()
        : 'Imported workspace';
    const newWorkspaceId = createId();
    idMap.workspace.set((sourceWs?.id as string) || 'source', newWorkspaceId);
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: newWorkspaceId,
        ownerUserId: user.userId,
        name: wsName,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(workspaceMemberships).values({
        workspaceId: newWorkspaceId,
        userId: user.userId,
        role: 'admin',
        createdAt: now,
      });
    });
    resolvedWorkspaceId = newWorkspaceId;
  }

  const targetWorkspace = resolvedWorkspaceId;
  if (!targetWorkspace) return c.json({ message: 'Target workspace not resolved' }, 400);

  const mappedFolderMatrix = new Map<string, string>();
  for (const m of matrixJson) {
    if (typeof m.folder_id === 'string' && typeof m.matrix_config === 'string') {
      mappedFolderMatrix.set(m.folder_id, m.matrix_config);
    }
  }

  await db.transaction(async (tx) => {
    for (const org of organizationsJson) {
      const newId = createId();
      idMap.organization.set(String(org.id), newId);
      await tx.insert(organizations).values({
        id: newId,
        workspaceId: targetWorkspace,
        name: typeof org.name === 'string' ? org.name : 'Imported organization',
        status: typeof org.status === 'string' ? org.status : 'completed',
        data: typeof org.data === 'object' && org.data ? org.data : {},
        createdAt: parseDate(org.created_at as string | null),
        updatedAt: parseDate(org.updated_at as string | null),
      });
    }

    for (const folder of foldersJson) {
      const newId = createId();
      idMap.folder.set(String(folder.id), newId);
      const orgId = typeof folder.organization_id === 'string' ? idMap.organization.get(folder.organization_id) : null;
      const matrixConfig =
        typeof folder.matrix_config === 'string'
          ? folder.matrix_config
          : mappedFolderMatrix.get(String(folder.id)) ?? null;
      await tx.insert(folders).values({
        id: newId,
        workspaceId: targetWorkspace,
        name: typeof folder.name === 'string' ? folder.name : 'Imported folder',
        description: typeof folder.description === 'string' ? folder.description : null,
        organizationId: orgId ?? null,
        matrixConfig,
        executiveSummary: typeof folder.executive_summary === 'string' ? folder.executive_summary : null,
        status: typeof folder.status === 'string' ? folder.status : 'completed',
        createdAt: parseDate(folder.created_at as string | null),
      });
    }

    for (const useCase of useCasesJson) {
      const newId = createId();
      idMap.usecase.set(String(useCase.id), newId);
      let folderId = typeof useCase.folder_id === 'string' ? idMap.folder.get(useCase.folder_id) : null;
      if (!folderId) {
        const fallbackKey = typeof useCase.folder_id === 'string' ? useCase.folder_id : `fallback-${newId}`;
        const existingFallback = idMap.folder.get(fallbackKey);
        if (existingFallback) {
          folderId = existingFallback;
        } else {
          const fallbackId = createId();
          idMap.folder.set(fallbackKey, fallbackId);
          await tx.insert(folders).values({
            id: fallbackId,
            workspaceId: targetWorkspace,
            name: 'Imported folder',
            description: null,
            organizationId: null,
            matrixConfig: null,
            executiveSummary: null,
            status: 'completed',
            createdAt: now,
          });
          folderId = fallbackId;
        }
      }
      const orgId = typeof useCase.organization_id === 'string' ? idMap.organization.get(useCase.organization_id) : null;
      await tx.insert(useCases).values({
        id: newId,
        workspaceId: targetWorkspace,
        folderId,
        organizationId: orgId ?? null,
        status: typeof useCase.status === 'string' ? useCase.status : 'completed',
        model: typeof useCase.model === 'string' ? useCase.model : null,
        data: typeof useCase.data === 'object' && useCase.data ? useCase.data : {},
        createdAt: parseDate(useCase.created_at as string | null),
      });
    }

    if (Array.isArray(commentsJson) && (manifest.include_comments as boolean) !== false) {
      for (const comment of commentsJson) {
        const contextType = typeof comment.context_type === 'string' ? comment.context_type : '';
        let contextId: string | null = null;
        if (contextType === 'organization') contextId = idMap.organization.get(String(comment.context_id)) ?? null;
        if (contextType === 'folder' || contextType === 'matrix') contextId = idMap.folder.get(String(comment.context_id)) ?? null;
        if (contextType === 'usecase') contextId = idMap.usecase.get(String(comment.context_id)) ?? null;
        if (!contextId) continue;

        const threadKey = typeof comment.thread_id === 'string' ? comment.thread_id : '';
        const threadId = idMap.thread.get(threadKey) ?? createId();
        idMap.thread.set(threadKey, threadId);

        await tx.insert(comments).values({
          id: createId(),
          workspaceId: targetWorkspace,
          contextType,
          contextId,
          sectionKey: typeof comment.section_key === 'string' ? comment.section_key : null,
          createdBy: user.userId,
          assignedTo: user.userId,
          status: comment.status === 'closed' ? 'closed' : 'open',
          threadId,
          content: typeof comment.content === 'string' ? comment.content : '',
          createdAt: parseDate(comment.created_at as string | null),
          updatedAt: parseDate(comment.updated_at as string | null),
        });
      }
    }
  });

  if ((manifest.include_documents as boolean) !== false) {
    const bucket = getDocumentsBucketName();
    const docEntries = manifestFiles.filter((f) => f.path.startsWith('documents/'));
    for (const entry of docEntries) {
      const match = entry.path.match(/^documents\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)-(.+)$/);
      if (!match) continue;
      const [, , contextType, contextId, , filename] = match;
      let newContextId: string | null = null;
      if (contextType === 'organization') newContextId = idMap.organization.get(contextId) ?? null;
      if (contextType === 'folder' || contextType === 'matrix') newContextId = idMap.folder.get(contextId) ?? null;
      if (contextType === 'usecase') newContextId = idMap.usecase.get(contextId) ?? null;
      if (!newContextId) continue;

      const fileEntry = zip.file(entry.path);
      if (!fileEntry) continue;
      const fileBytes = await fileEntry.async('uint8array');
      const safeName = filename.replace(/[^\w.\- ()]/g, '_');
      const docId = createId();
      const storageKey = `documents/${targetWorkspace}/${contextType}/${newContextId}/${docId}-${safeName}`;
      await putObject({
        bucket,
        key: storageKey,
        body: fileBytes,
        contentType: guessMimeType(safeName),
      });
      await db.insert(contextDocuments).values({
        id: docId,
        workspaceId: targetWorkspace,
        contextType,
        contextId: newContextId,
        filename: safeName,
        mimeType: guessMimeType(safeName),
        sizeBytes: fileBytes.byteLength,
        storageKey,
        status: 'uploaded',
        data: { summaryLang: 'fr' },
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }
  }

  return c.json({ workspace_id: targetWorkspace, scope: manifestScope.data, imported: true });
});
