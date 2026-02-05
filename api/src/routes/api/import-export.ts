import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
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

const includeSchema = z.enum([
  'comments',
  'documents',
  'organization',
  'organizations',
  'folders',
  'usecases',
  'matrix',
]);

const exportSchema = z.object({
  scope: scopeSchema,
  scope_id: z.string().optional(),
  include_comments: z.boolean().optional().default(true),
  include_documents: z.boolean().optional().default(true),
  include: z.array(includeSchema).optional(),
  export_kind: z.enum(['organizations', 'folders']).optional(),
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

function slugifyName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function formatDateStamp(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function getLatestCommentDate(params: {
  workspaceId: string;
  contextType?: string;
  contextId?: string;
  contextIds?: string[];
}): Promise<Date | null> {
  const conditions = [eq(comments.workspaceId, params.workspaceId)];
  if (params.contextType) conditions.push(eq(comments.contextType, params.contextType));
  if (params.contextId) conditions.push(eq(comments.contextId, params.contextId));
  if (params.contextIds && params.contextIds.length > 0) {
    conditions.push(inArray(comments.contextId, params.contextIds));
  }
  const [row] = await db
    .select({ maxUpdatedAt: sql`max(${comments.updatedAt})` })
    .from(comments)
    .where(and(...conditions));
  const raw = row?.maxUpdatedAt as Date | string | null | undefined;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getUseCaseName(row: typeof useCases.$inferSelect): string {
  const data = row.data as Record<string, unknown> | null | undefined;
  const name = typeof data?.name === 'string' ? data.name : '';
  return name.trim() || 'cas-usage';
}

async function resolveExportFileInfo(opts: {
  workspaceId: string;
  scope: z.infer<typeof scopeSchema>;
  scopeId: string | null;
  exportKind?: 'organizations' | 'folders';
}): Promise<{ prefix: string; slug: string; date: Date | null }> {
  if (opts.scope === 'workspace') {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, opts.workspaceId)).limit(1);
    const wsName = ws?.name?.trim() || 'workspace';
    const latestComment = await getLatestCommentDate({ workspaceId: opts.workspaceId });
    const date = latestComment || ws?.updatedAt || ws?.createdAt || null;
    const slug = slugifyName(wsName) || 'workspace';
    const suffix = opts.exportKind === 'folders' ? 'dossiers' : opts.exportKind === 'organizations' ? 'organisations' : null;
    if (suffix) {
      return { prefix: `workspace_${slug}_${suffix}`, slug: '', date };
    }
    return { prefix: 'workspace', slug, date };
  }
  if (!opts.scopeId) {
    return { prefix: opts.scope, slug: 'export', date: null };
  }

  if (opts.scope === 'organization') {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, opts.scopeId)).limit(1);
    const name = org?.name?.trim() || 'organisation';
    const latestComment = await getLatestCommentDate({
      workspaceId: opts.workspaceId,
      contextType: 'organization',
      contextId: opts.scopeId,
    });
    const date = latestComment || org?.updatedAt || org?.createdAt || null;
    return { prefix: 'organisation', slug: slugifyName(name) || 'organisation', date };
  }

  if (opts.scope === 'folder') {
    const [folder] = await db.select().from(folders).where(eq(folders.id, opts.scopeId)).limit(1);
    const name = folder?.name?.trim() || 'dossier';
    const useCaseRows = await db
      .select({ id: useCases.id, createdAt: useCases.createdAt })
      .from(useCases)
      .where(eq(useCases.folderId, opts.scopeId));
    const useCaseIds = useCaseRows.map((r) => r.id);
    const latestUseCase = useCaseRows.reduce<Date | null>((acc, row) => {
      const d = row.createdAt ?? null;
      if (!d) return acc;
      if (!acc || d > acc) return d;
      return acc;
    }, null);
    const latestFolderComment = await getLatestCommentDate({
      workspaceId: opts.workspaceId,
      contextType: 'folder',
      contextId: opts.scopeId,
    });
    const latestUseCaseComment =
      useCaseIds.length > 0
        ? await getLatestCommentDate({
            workspaceId: opts.workspaceId,
            contextType: 'usecase',
            contextIds: useCaseIds,
          })
        : null;
    const date = [latestUseCaseComment, latestFolderComment, latestUseCase, folder?.createdAt]
      .filter(Boolean)
      .reduce<Date | null>((acc, d) => {
        const next = d as Date;
        if (!acc || next > acc) return next;
        return acc;
      }, null);
    return { prefix: 'dossier', slug: slugifyName(name) || 'dossier', date };
  }

  if (opts.scope === 'usecase') {
    const [useCase] = await db.select().from(useCases).where(eq(useCases.id, opts.scopeId)).limit(1);
    const name = useCase ? getUseCaseName(useCase) : 'cas-usage';
    const latestComment = await getLatestCommentDate({
      workspaceId: opts.workspaceId,
      contextType: 'usecase',
      contextId: opts.scopeId,
    });
    const date = latestComment || useCase?.createdAt || null;
    return { prefix: 'cas-usage', slug: slugifyName(name) || 'cas-usage', date };
  }

  if (opts.scope === 'matrix') {
    return { prefix: 'matrix', slug: slugifyName(opts.scopeId) || 'matrix', date: new Date() };
  }

  return { prefix: opts.scope, slug: 'export', date: null };
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

const parseJsonValue = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

function mapFolder(row: typeof folders.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    description: row.description,
    organization_id: row.organizationId,
    matrix_config: parseJsonValue(row.matrixConfig),
    executive_summary: parseJsonValue(row.executiveSummary),
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
    tool_call_id: row.toolCallId ?? null,
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
  includeOrganization: boolean;
  includeFolders: boolean;
  includeWorkspaceOrganizations: boolean;
  includeWorkspaceFolders: boolean;
  includeWorkspaceUseCases: boolean;
  includeWorkspaceMatrix: boolean;
  includeFolderUseCases: boolean;
  includeFolderMatrix: boolean;
  includeUseCaseFolder: boolean;
  includeUseCaseMatrix: boolean;
  includeUseCaseOrganization: boolean;
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

    const includeFolders = opts.includeWorkspaceFolders || opts.includeWorkspaceUseCases;
    const includeUseCases = opts.includeWorkspaceUseCases;
    const includeMatrix = opts.includeWorkspaceMatrix || includeFolders;

    const folderRows = includeFolders
      ? await db.select().from(folders).where(eq(folders.workspaceId, opts.workspaceId))
      : [];
    const folderIds = folderRows.map((f) => f.id);
    const useCaseRows =
      includeUseCases && folderIds.length > 0
        ? await db
            .select()
            .from(useCases)
            .where(and(eq(useCases.workspaceId, opts.workspaceId), inArray(useCases.folderId, folderIds)))
        : [];

    const orgRows = opts.includeWorkspaceOrganizations
      ? await db
          .select()
          .from(organizations)
          .where(eq(organizations.workspaceId, opts.workspaceId))
      : [];

    const orgRowsFiltered =
      opts.includeWorkspaceOrganizations && includeFolders
        ? orgRows.filter((o) => folderRows.some((f) => f.organizationId === o.id))
        : orgRows;

    payload.organizations = orgRowsFiltered.map(mapOrganization);
    payload.folders = folderRows.map(mapFolder);
    payload.use_cases = useCaseRows.map(mapUseCase);
    payload.matrix = includeMatrix
      ? folderRows
          .filter((f) => typeof f.matrixConfig === 'string' && f.matrixConfig.length > 0)
          .map((f) => ({ folder_id: f.id, matrix_config: parseJsonValue(f.matrixConfig) }))
      : [];

    if (opts.includeComments) {
      const commentFilters = [];
      if (payload.organizations.length > 0) {
        commentFilters.push(
          and(
            eq(comments.contextType, 'organization'),
            inArray(comments.contextId, payload.organizations.map((o) => String(o.id)))
          )
        );
      }
      if (payload.folders.length > 0) {
        commentFilters.push(
          and(
            eq(comments.contextType, 'folder'),
            inArray(comments.contextId, payload.folders.map((f) => String(f.id)))
          )
        );
      }
      if (payload.use_cases.length > 0) {
        commentFilters.push(
          and(
            eq(comments.contextType, 'usecase'),
            inArray(comments.contextId, payload.use_cases.map((u) => String(u.id)))
          )
        );
      }
      if (commentFilters.length > 0) {
        const commentRows = await db
          .select()
          .from(comments)
          .where(and(eq(comments.workspaceId, opts.workspaceId), or(...commentFilters)));
        payload.comments = commentRows.map(mapComment);
      }
    }
    if (opts.includeDocuments) {
      const docFilters = [];
      if (payload.organizations.length > 0) {
        docFilters.push(
          and(
            eq(contextDocuments.contextType, 'organization'),
            inArray(contextDocuments.contextId, payload.organizations.map((o) => String(o.id)))
          )
        );
      }
      if (payload.folders.length > 0) {
        docFilters.push(
          and(
            eq(contextDocuments.contextType, 'folder'),
            inArray(contextDocuments.contextId, payload.folders.map((f) => String(f.id)))
          )
        );
      }
      if (payload.use_cases.length > 0) {
        docFilters.push(
          and(
            eq(contextDocuments.contextType, 'usecase'),
            inArray(contextDocuments.contextId, payload.use_cases.map((u) => String(u.id)))
          )
        );
      }
      if (docFilters.length > 0) {
        const docRows = await db
          .select()
          .from(contextDocuments)
          .where(and(eq(contextDocuments.workspaceId, opts.workspaceId), or(...docFilters)));
        documents.push(...docRows);
      }
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

    const folderRows = opts.includeFolders
      ? await db
          .select()
          .from(folders)
          .where(and(eq(folders.workspaceId, opts.workspaceId), eq(folders.organizationId, scopeId)))
      : [];
    payload.folders = folderRows.map(mapFolder);
    payload.matrix = opts.includeFolders
      ? folderRows
          .filter((f) => typeof f.matrixConfig === 'string' && f.matrixConfig.length > 0)
          .map((f) => ({ folder_id: f.id, matrix_config: parseJsonValue(f.matrixConfig) }))
      : [];

    const folderIds = folderRows.map((f) => f.id);
    const useCaseRows =
      opts.includeFolders && folderIds.length > 0
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
      if (opts.includeFolders && folderIds.length > 0) {
        commentFilters.push(and(eq(comments.contextType, 'folder'), inArray(comments.contextId, folderIds)));
      }
      if (opts.includeFolders && useCaseIds.length > 0) {
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
      if (opts.includeFolders && folderIds.length > 0) {
        docFilters.push(and(eq(contextDocuments.contextType, 'folder'), inArray(contextDocuments.contextId, folderIds)));
      }
      if (opts.includeFolders && useCaseIds.length > 0) {
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
    if (opts.scope === 'matrix') {
      if (typeof folder.matrixConfig === 'string' && folder.matrixConfig.length > 0) {
        payload.matrix = [{ folder_id: folder.id, matrix_config: parseJsonValue(folder.matrixConfig) }];
      }
      if (opts.includeComments) {
        const commentRows = await db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.workspaceId, opts.workspaceId),
              eq(comments.contextType, 'matrix'),
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
              eq(contextDocuments.contextType, 'matrix'),
              eq(contextDocuments.contextId, scopeId)
            )
          );
        documents.push(...docRows);
      }
      return { payload, documents };
    }

    payload.folders = [mapFolder(folder)];
    if (opts.includeOrganization && folder.organizationId) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.workspaceId, opts.workspaceId), eq(organizations.id, folder.organizationId)))
        .limit(1);
      if (org) payload.organizations = [mapOrganization(org)];
    }
    if (opts.includeFolderMatrix && typeof folder.matrixConfig === 'string' && folder.matrixConfig.length > 0) {
      payload.matrix = [{ folder_id: folder.id, matrix_config: parseJsonValue(folder.matrixConfig) }];
    }

    if (opts.scope === 'folder') {
      const useCaseRows = opts.includeFolderUseCases
        ? await db
            .select()
            .from(useCases)
            .where(and(eq(useCases.workspaceId, opts.workspaceId), eq(useCases.folderId, scopeId)))
        : [];
      payload.use_cases = useCaseRows.map(mapUseCase);

      if (opts.includeComments) {
        const useCaseIds = useCaseRows.map((u) => u.id);
        const commentFilters = [
          and(eq(comments.contextType, 'folder'), eq(comments.contextId, scopeId)),
        ];
        if (useCaseIds.length > 0) {
          commentFilters.push(and(eq(comments.contextType, 'usecase'), inArray(comments.contextId, useCaseIds)));
        }
        if (opts.includeFolderMatrix) {
          commentFilters.push(and(eq(comments.contextType, 'matrix'), eq(comments.contextId, scopeId)));
        }
        if (opts.includeOrganization && folder.organizationId) {
          commentFilters.push(and(eq(comments.contextType, 'organization'), eq(comments.contextId, folder.organizationId)));
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
        if (opts.includeFolderMatrix) {
          docFilters.push(and(eq(contextDocuments.contextType, 'matrix'), eq(contextDocuments.contextId, scopeId)));
        }
        if (opts.includeOrganization && folder.organizationId) {
          docFilters.push(and(eq(contextDocuments.contextType, 'organization'), eq(contextDocuments.contextId, folder.organizationId)));
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

    const shouldIncludeFolder = opts.includeUseCaseFolder || opts.includeUseCaseMatrix;
    const [folder] = shouldIncludeFolder
      ? await db
          .select()
          .from(folders)
          .where(and(eq(folders.id, useCase.folderId), eq(folders.workspaceId, opts.workspaceId)))
          .limit(1)
      : [null];
    if (folder) {
      payload.folders = [mapFolder(folder)];
      if (opts.includeUseCaseMatrix && typeof folder.matrixConfig === 'string' && folder.matrixConfig.length > 0) {
        payload.matrix = [{ folder_id: folder.id, matrix_config: parseJsonValue(folder.matrixConfig) }];
      }
    }
    if (opts.includeUseCaseOrganization && useCase.organizationId) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, useCase.organizationId), eq(organizations.workspaceId, opts.workspaceId)))
        .limit(1);
      if (org) payload.organizations = [mapOrganization(org)];
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
      if (folder && opts.includeUseCaseFolder) {
        const folderComments = await db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.workspaceId, opts.workspaceId),
              eq(comments.contextType, 'folder'),
              eq(comments.contextId, folder.id)
            )
          );
        payload.comments.push(...folderComments.map(mapComment));
      }
      if (folder && opts.includeUseCaseMatrix) {
        const matrixComments = await db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.workspaceId, opts.workspaceId),
              eq(comments.contextType, 'matrix'),
              eq(comments.contextId, folder.id)
            )
          );
        payload.comments.push(...matrixComments.map(mapComment));
      }
      if (opts.includeUseCaseOrganization && useCase.organizationId) {
        const orgComments = await db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.workspaceId, opts.workspaceId),
              eq(comments.contextType, 'organization'),
              eq(comments.contextId, useCase.organizationId)
            )
          );
        payload.comments.push(...orgComments.map(mapComment));
      }
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
      if (folder && opts.includeUseCaseFolder) {
        const folderDocs = await db
          .select()
          .from(contextDocuments)
          .where(
            and(
              eq(contextDocuments.workspaceId, opts.workspaceId),
              eq(contextDocuments.contextType, 'folder'),
              eq(contextDocuments.contextId, folder.id)
            )
          );
        documents.push(...folderDocs);
      }
      if (folder && opts.includeUseCaseMatrix) {
        const matrixDocs = await db
          .select()
          .from(contextDocuments)
          .where(
            and(
              eq(contextDocuments.workspaceId, opts.workspaceId),
              eq(contextDocuments.contextType, 'matrix'),
              eq(contextDocuments.contextId, folder.id)
            )
          );
        documents.push(...matrixDocs);
      }
      if (opts.includeUseCaseOrganization && useCase.organizationId) {
        const orgDocs = await db
          .select()
          .from(contextDocuments)
          .where(
            and(
              eq(contextDocuments.workspaceId, opts.workspaceId),
              eq(contextDocuments.contextType, 'organization'),
              eq(contextDocuments.contextId, useCase.organizationId)
            )
          );
        documents.push(...orgDocs);
      }
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

  const includeSet = new Set(Array.isArray(body.include) ? body.include : []);
  const hasIncludeArray = includeSet.size > 0;
  const includeComments = hasIncludeArray ? includeSet.has('comments') : (body.include_comments ?? true);
  const includeDocuments = hasIncludeArray ? includeSet.has('documents') : (body.include_documents ?? true);
  const includeOrganization = includeSet.has('organization');
  const includeFolders = includeSet.has('folders');
  const includeFolderUseCases = hasIncludeArray ? includeSet.has('usecases') : true;
  const includeFolderMatrix = hasIncludeArray ? includeSet.has('matrix') : true;
  const includeUseCaseFolder = hasIncludeArray ? includeSet.has('folders') : true;
  const includeUseCaseMatrix = hasIncludeArray ? includeSet.has('matrix') : true;
  const includeUseCaseOrganization = hasIncludeArray ? includeSet.has('organization') : true;
  const includeWorkspaceOrganizations = hasIncludeArray ? includeSet.has('organizations') : true;
  const includeWorkspaceFolders = hasIncludeArray ? includeSet.has('folders') : true;
  const includeWorkspaceUseCases = hasIncludeArray ? includeSet.has('usecases') : true;
  const includeWorkspaceMatrix = hasIncludeArray ? includeSet.has('matrix') : true;

  const { payload, documents } = await collectExportData({
    workspaceId: user.workspaceId,
    scope: body.scope,
    scopeId,
    includeComments,
    includeDocuments,
    includeOrganization,
    includeFolders,
    includeWorkspaceOrganizations,
    includeWorkspaceFolders,
    includeWorkspaceUseCases,
    includeWorkspaceMatrix,
    includeFolderUseCases,
    includeFolderMatrix,
    includeUseCaseFolder,
    includeUseCaseMatrix,
    includeUseCaseOrganization,
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

  const commentMap = new Map<string, Array<Record<string, unknown>>>();
  if (includeComments && payload.comments.length > 0) {
    for (const comment of payload.comments) {
      const contextType = typeof comment.context_type === 'string' ? comment.context_type : '';
      const contextId = typeof comment.context_id === 'string' ? comment.context_id : '';
      if (!contextType || !contextId) continue;
      const key = `${contextType}:${contextId}`;
      const list = commentMap.get(key) ?? [];
      list.push(comment);
      commentMap.set(key, list);
    }
  }

  const withComments = (base: Record<string, unknown>, contextType: string, contextId: string) => {
    if (!includeComments) return base;
    const comments = commentMap.get(`${contextType}:${contextId}`) ?? [];
    if (comments.length === 0) return base;
    return { ...base, comments };
  };

  for (const org of payload.organizations) {
    const orgId = String((org as Record<string, unknown>).id ?? '');
    if (!orgId) continue;
    addZipFile(`organization_${orgId}.json`, encodeJson(withComments(org, 'organization', orgId)));
  }
  for (const folder of payload.folders) {
    const folderId = String((folder as Record<string, unknown>).id ?? '');
    if (!folderId) continue;
    addZipFile(`folder_${folderId}.json`, encodeJson(withComments(folder, 'folder', folderId)));
  }
  for (const useCase of payload.use_cases) {
    const useCaseId = String((useCase as Record<string, unknown>).id ?? '');
    if (!useCaseId) continue;
    addZipFile(`usecase_${useCaseId}.json`, encodeJson(withComments(useCase, 'usecase', useCaseId)));
  }
  for (const matrix of payload.matrix) {
    const folderId = String((matrix as Record<string, unknown>).folder_id ?? '');
    if (!folderId) continue;
    const matrixPayload = includeComments
      ? withComments(matrix as Record<string, unknown>, 'matrix', folderId)
      : (matrix as Record<string, unknown>);
    addZipFile(`matrix_${folderId}.json`, encodeJson(matrixPayload));
  }

  if (includeDocuments) {
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
    include_comments: includeComments,
    include_documents: includeDocuments,
    include: Array.from(includeSet),
    files: manifestFiles.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
  };
  const manifestHash = sha256Bytes(encodeJson(manifestCore));
  const manifest = { ...manifestCore, manifest_hash: manifestHash };
  zip.file('manifest.json', encodeJson(manifest));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipBuffer = Buffer.from(zipBytes);
  const fileInfo = await resolveExportFileInfo({
    workspaceId: user.workspaceId,
    scope: body.scope,
    scopeId,
    exportKind: body.export_kind,
  });
  const dateStamp = formatDateStamp(fileInfo.date);
  const slug = fileInfo.slug || 'export';
  const fileName = fileInfo.slug
    ? `${fileInfo.prefix}_${slug}_${dateStamp}.zip`
    : `${fileInfo.prefix}_${dateStamp}.zip`;
  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="${fileName}"`);
  c.header('Access-Control-Expose-Headers', 'Content-Disposition');
  return c.newResponse(zipBuffer, 200);
});

importsRouter.post('/preview', async (c) => {
  const form = await c.req.raw.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ message: 'Missing file' }, 400);
  }

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

  const objects = {
    organizations: [] as Array<{ id: string; name: string }>,
    folders: [] as Array<{ id: string; name: string }>,
    usecases: [] as Array<{ id: string; name: string }>,
    matrix: [] as Array<{ id: string; name: string }>,
  };
  let hasComments = false;
  for (const entry of manifestFiles) {
    if (!entry.path.endsWith('.json')) continue;
    if (entry.path.startsWith('organization_')) {
      const text = await zip.file(entry.path)?.async('string');
      if (!text) continue;
      const obj = JSON.parse(text) as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : '';
      const name = typeof obj.name === 'string' ? obj.name : 'Organisation';
      if (id) objects.organizations.push({ id, name });
      if (Array.isArray(obj.comments) && obj.comments.length > 0) hasComments = true;
      continue;
    }
    if (entry.path.startsWith('folder_')) {
      const text = await zip.file(entry.path)?.async('string');
      if (!text) continue;
      const obj = JSON.parse(text) as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : '';
      const name = typeof obj.name === 'string' ? obj.name : 'Dossier';
      if (id) objects.folders.push({ id, name });
      if (Array.isArray(obj.comments) && obj.comments.length > 0) hasComments = true;
      continue;
    }
    if (entry.path.startsWith('usecase_')) {
      const text = await zip.file(entry.path)?.async('string');
      if (!text) continue;
      const obj = JSON.parse(text) as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : '';
      const data = obj.data as Record<string, unknown> | null | undefined;
      const name =
        (typeof data?.name === 'string' && data.name.trim()) ||
        (typeof obj.name === 'string' && obj.name.trim()) ||
        "Cas d'usage";
      if (id) objects.usecases.push({ id, name });
      if (Array.isArray(obj.comments) && obj.comments.length > 0) hasComments = true;
      continue;
    }
    if (entry.path.startsWith('matrix_')) {
      const text = await zip.file(entry.path)?.async('string');
      if (!text) continue;
      const obj = JSON.parse(text) as Record<string, unknown>;
      const match = entry.path.match(/^matrix_([^/]+)\.json$/);
      const id = match ? match[1] : '';
      const name = id ? `Matrice (${id})` : 'Matrice';
      if (id) objects.matrix.push({ id, name });
      if (Array.isArray(obj.comments) && obj.comments.length > 0) hasComments = true;
      continue;
    }
  }

  const hasDocuments = manifestFiles.some((entry) => entry.path.startsWith('documents/'));
  return c.json({
    scope: manifestScope.data,
    objects,
    has_comments: hasComments,
    has_documents: hasDocuments,
  });
});

importsRouter.post('/', async (c) => {
  const user = c.get('user') as { workspaceId: string; userId: string };
  const form = await c.req.raw.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ message: 'Missing file' }, 400);
  }
  const parseBool = (value: unknown): boolean | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return null;
  };

  const targetWorkspaceIdRaw = form.get('target_workspace_id');
  const targetWorkspaceId =
    typeof targetWorkspaceIdRaw === 'string' && targetWorkspaceIdRaw.trim().length > 0
      ? targetWorkspaceIdRaw.trim()
      : null;
  const targetFolderIdRaw = form.get('target_folder_id');
  const targetFolderId =
    typeof targetFolderIdRaw === 'string' && targetFolderIdRaw.trim().length > 0
      ? targetFolderIdRaw.trim()
      : null;
  const targetFolderCreate = parseBool(form.get('target_folder_create')) === true;
  const targetFolderSourceRaw = form.get('target_folder_source_id');
  const targetFolderSourceId =
    typeof targetFolderSourceRaw === 'string' && targetFolderSourceRaw.trim().length > 0
      ? targetFolderSourceRaw.trim()
      : null;

  const selectedRaw = form.get('selected');
  let selected: Record<string, string[]> | null = null;
  if (typeof selectedRaw === 'string' && selectedRaw.trim().length > 0) {
    try {
      const parsed = JSON.parse(selectedRaw) as Record<string, string[]>;
      selected = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return c.json({ message: 'Invalid selected payload' }, 400);
    }
  }
  const selectedTypesRaw = form.get('selected_types');
  let selectedTypes: string[] | null = null;
  if (typeof selectedTypesRaw === 'string' && selectedTypesRaw.trim().length > 0) {
    try {
      const parsed = JSON.parse(selectedTypesRaw);
      if (Array.isArray(parsed)) {
        selectedTypes = parsed.filter((item) => typeof item === 'string') as string[];
      }
    } catch {
      return c.json({ message: 'Invalid selected_types payload' }, 400);
    }
  }

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

  const readJsonObject = async (path: string): Promise<Record<string, unknown> | null> => {
    const entry = zip.file(path);
    if (!entry) return null;
    const text = await entry.async('string');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  };

  const workspacesJson = await readJsonArray('workspaces.json');
  const organizationsJson: Array<Record<string, unknown>> = [];
  const foldersJson: Array<Record<string, unknown>> = [];
  const useCasesJson: Array<Record<string, unknown>> = [];
  const commentsJson: Array<Record<string, unknown>> = [];
  const matrixJson: Array<Record<string, unknown>> = [];

  const includeCommentsOverride = parseBool(form.get('include_comments'));
  const includeDocumentsOverride = parseBool(form.get('include_documents'));
  const allowComments = includeCommentsOverride ?? ((manifest.include_comments as boolean) !== false);
  const allowDocuments = includeDocumentsOverride ?? ((manifest.include_documents as boolean) !== false);

  const isSelected = (type: string, id: string) => {
    const list = selected?.[type];
    if (!list || list.length === 0) return true;
    return list.includes(id);
  };
  const isTypeSelected = (type: string) => {
    if (!selectedTypes || selectedTypes.length === 0) return true;
    return selectedTypes.includes(type);
  };

  const stripComments = (obj: Record<string, unknown>) => {
    const { comments, ...rest } = obj;
    const list = allowComments && Array.isArray(comments) ? (comments as Array<Record<string, unknown>>) : [];
    if (list.length > 0) commentsJson.push(...list);
    return rest;
  };

  for (const entry of manifestFiles) {
    if (!entry.path.endsWith('.json')) continue;
    if (entry.path.startsWith('organization_')) {
      if (!isTypeSelected('organizations')) continue;
      const obj = await readJsonObject(entry.path);
      const id = obj && typeof obj.id === 'string' ? obj.id : '';
      if (obj && id && isSelected('organizations', id)) organizationsJson.push(stripComments(obj));
      continue;
    }
    if (entry.path.startsWith('folder_')) {
      const obj = await readJsonObject(entry.path);
      const id = obj && typeof obj.id === 'string' ? obj.id : '';
      const isTargetFolderSource = targetFolderSourceId && id === targetFolderSourceId;
      if (obj && id && (isTargetFolderSource || (isTypeSelected('folders') && isSelected('folders', id)))) {
        foldersJson.push(stripComments(obj));
      }
      continue;
    }
    if (entry.path.startsWith('usecase_')) {
      if (!isTypeSelected('usecases')) continue;
      const obj = await readJsonObject(entry.path);
      const id = obj && typeof obj.id === 'string' ? obj.id : '';
      if (obj && id && isSelected('usecases', id)) useCasesJson.push(stripComments(obj));
      continue;
    }
    if (entry.path.startsWith('matrix_')) {
      if (!isTypeSelected('matrix')) continue;
      const obj = await readJsonObject(entry.path);
      if (!obj) continue;
      const { comments, ...rest } = obj;
      if (allowComments && Array.isArray(comments)) commentsJson.push(...(comments as Array<Record<string, unknown>>));
      const match = entry.path.match(/^matrix_([^/]+)\.json$/);
      const folderId = match ? match[1] : null;
      if (folderId && !isSelected('matrix', folderId)) {
        continue;
      }
      if (folderId && typeof rest.folder_id !== 'string') {
        rest.folder_id = folderId;
      }
      matrixJson.push(rest);
    }
  }

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
        : "Workspace d'import";
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

  let targetFolder: typeof folders.$inferSelect | null = null;
  if (targetFolderId && !targetFolderCreate && !targetFolderSourceId) {
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, targetFolderId), eq(folders.workspaceId, targetWorkspace)))
      .limit(1);
    if (!folder) {
      return c.json({ message: 'Target folder not found' }, 400);
    }
    targetFolder = folder;
  }

  const toJsonString = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  };

  const mappedFolderMatrix = new Map<string, string>();
  for (const m of matrixJson) {
    if (typeof m.folder_id !== 'string') continue;
    const matrixValue = toJsonString(m.matrix_config);
    if (!matrixValue) continue;
    mappedFolderMatrix.set(m.folder_id, matrixValue);
  }

  await db.transaction(async (tx) => {
    let createdTargetFolder: typeof folders.$inferSelect | null = null;
    if (!targetFolder && (targetFolderCreate || targetFolderSourceId)) {
      const sourceFolder =
        targetFolderSourceId && targetFolderSourceId !== 'new'
          ? foldersJson.find((f) => String(f.id) === targetFolderSourceId)
          : null;
      const folderName =
        (sourceFolder && typeof sourceFolder.name === 'string' && sourceFolder.name.trim()) ||
        "Dossier d'import";
      const folderDescription =
        sourceFolder && typeof sourceFolder.description === 'string' ? sourceFolder.description : null;
      const sourceOrgId =
        sourceFolder && typeof sourceFolder.organization_id === 'string'
          ? idMap.organization.get(sourceFolder.organization_id) ?? null
          : null;
      const matrixConfig =
        sourceFolder && typeof sourceFolder.id === 'string'
          ? (toJsonString(sourceFolder.matrix_config) ?? mappedFolderMatrix.get(String(sourceFolder.id)) ?? null)
          : null;
      const executiveSummary = sourceFolder ? toJsonString(sourceFolder.executive_summary) : null;
      const newFolderId = createId();
      await tx.insert(folders).values({
        id: newFolderId,
        workspaceId: targetWorkspace,
        name: folderName,
        description: folderDescription,
        organizationId: sourceOrgId,
        matrixConfig,
        executiveSummary,
        status: 'completed',
        createdAt: now,
      });
      createdTargetFolder = {
        id: newFolderId,
        workspaceId: targetWorkspace,
        name: folderName,
        description: folderDescription,
        organizationId: sourceOrgId,
        matrixConfig,
        executiveSummary,
        status: 'completed',
        createdAt: now,
      } as typeof folders.$inferSelect;
    }

    if (createdTargetFolder) {
      targetFolder = createdTargetFolder;
    }

    if (!targetFolder) {
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
          toJsonString(folder.matrix_config) ?? mappedFolderMatrix.get(String(folder.id)) ?? null;
        const executiveSummary = toJsonString(folder.executive_summary);
        await tx.insert(folders).values({
          id: newId,
          workspaceId: targetWorkspace,
          name: typeof folder.name === 'string' ? folder.name : "Dossier d'import",
          description: typeof folder.description === 'string' ? folder.description : null,
          organizationId: orgId ?? null,
          matrixConfig,
          executiveSummary,
          status: typeof folder.status === 'string' ? folder.status : 'completed',
          createdAt: parseDate(folder.created_at as string | null),
        });
      }
    }

    for (const useCase of useCasesJson) {
      const newId = createId();
      idMap.usecase.set(String(useCase.id), newId);
      let folderId: string | null = null;
      let orgId: string | null = null;
      if (targetFolder) {
        folderId = targetFolder.id;
        orgId = targetFolder.organizationId ?? null;
      } else {
        folderId = typeof useCase.folder_id === 'string' ? (idMap.folder.get(useCase.folder_id) ?? null) : null;
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
              name: "Dossier d'import",
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
        orgId = typeof useCase.organization_id === 'string' ? (idMap.organization.get(useCase.organization_id) ?? null) : null;
      }
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

    if (Array.isArray(commentsJson) && allowComments) {
      for (const comment of commentsJson) {
        const contextType = typeof comment.context_type === 'string' ? comment.context_type : '';
        if (targetFolder && contextType !== 'usecase') continue;
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
          toolCallId: typeof comment.tool_call_id === 'string' ? comment.tool_call_id : null,
          createdAt: parseDate(comment.created_at as string | null),
          updatedAt: parseDate(comment.updated_at as string | null),
        });
      }
    }
  });

  if (allowDocuments) {
    const bucket = getDocumentsBucketName();
    const docEntries = manifestFiles.filter((f) => f.path.startsWith('documents/'));
    for (const entry of docEntries) {
      const match = entry.path.match(/^documents\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)-(.+)$/);
      if (!match) continue;
      const [, , contextType, contextId, , filename] = match;
      if (targetFolder && contextType !== 'usecase') continue;
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

  return c.json({
    workspace_id: targetWorkspace,
    scope: manifestScope.data,
    imported: true,
    target_folder_id: targetFolder?.id ?? null,
  });
});
