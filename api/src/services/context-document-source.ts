import type { ContextDocumentRow } from '../db/schema';
import { getDocumentsBucketName, getObjectBytes } from './storage-s3';
import {
  loadGoogleDriveFileContent,
  resolveGoogleDriveFileMetadata,
  type GoogleDriveFileMetadata,
} from './google-drive-client';
import {
  resolveGoogleDriveTokenSecret,
  resolveGoogleDriveTokenSecretByAccountId,
} from './google-drive-connector-accounts';

export type ContextDocumentSourceKind = 'local' | 'google_drive' | 'sharepoint' | 'onedrive';

export type ContextDocumentSourceDescriptor =
  | {
      kind: 'local';
      storageKey: string;
    }
  | {
      kind: 'google_drive';
      fileId: string;
      // Connector account used for server-side/background jobs (e.g., document_summary).
      // User-scoped reads may instead use the acting user's connected account.
      connectorAccountId: string | null;
      mimeType: string | null; // original Drive mime type (not the exported one)
      exportMimeType: string | null;
      name: string | null;
    }
  | { kind: 'sharepoint' }
  | { kind: 'onedrive' };

export type ContextDocumentAccess =
  | { mode: 'user'; userId: string; workspaceId: string }
  | { mode: 'connector_account'; connectorAccountId: string };

export type LoadedContextDocumentContent = {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  source: ContextDocumentSourceDescriptor;
  exportMimeType: string | null;
  resolvedMetadata: GoogleDriveFileMetadata | null;
};

export type ContextDocumentSyncStatus = 'pending' | 'indexed' | 'stale' | 'failed';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getDataString(data: unknown, key: string): string | null {
  const rec = asRecord(data);
  const v = rec[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function getDataNullableString(data: unknown, key: string): string | null {
  const rec = asRecord(data);
  const v = rec[key];
  if (v === null) return null;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function inferSourceKind(value: unknown): ContextDocumentSourceKind {
  if (typeof value !== 'string') return 'local';
  const normalized = value.trim();
  return normalized === 'google_drive' || normalized === 'sharepoint' || normalized === 'onedrive'
    ? normalized
    : 'local';
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function buildGoogleDriveSourceData(input: {
  connectorAccountId: string | null;
  file: GoogleDriveFileMetadata;
  exportMimeType: string | null;
}): Record<string, unknown> {
  return {
    kind: 'google_drive',
    connectorAccountId: input.connectorAccountId,
    fileId: input.file.id,
    name: input.file.name,
    mimeType: input.file.mimeType,
    exportMimeType: input.exportMimeType,
    webViewLink: input.file.webViewLink,
    webContentLink: input.file.webContentLink,
    iconLink: input.file.iconLink,
    modifiedTime: input.file.modifiedTime,
    version: input.file.version,
    size: input.file.size,
    md5Checksum: input.file.md5Checksum,
    driveId: input.file.driveId,
  };
}

export function updateContextDocumentSyncData(input: {
  data: unknown;
  syncStatus?: ContextDocumentSyncStatus | null;
  lastSyncedAt?: Date | string | null;
  lastSyncError?: string | null;
  source?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const next = { ...asRecord(input.data) };

  if (input.syncStatus !== undefined) {
    if (input.syncStatus) next.syncStatus = input.syncStatus;
    else delete next.syncStatus;
  }

  if (input.lastSyncedAt !== undefined) {
    const iso = toIsoString(input.lastSyncedAt);
    if (iso) next.lastSyncedAt = iso;
    else delete next.lastSyncedAt;
  }

  if (input.lastSyncError !== undefined) {
    const trimmed = typeof input.lastSyncError === 'string' ? input.lastSyncError.trim() : '';
    if (trimmed) next.lastSyncError = trimmed;
    else delete next.lastSyncError;
  }

  if (input.source !== undefined) {
    if (input.source) next.source = input.source;
    else delete next.source;
  }

  return next;
}

export function readContextDocumentSyncData(data: unknown): {
  syncStatus: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
} {
  const rec = asRecord(data);
  const syncStatus =
    typeof rec.syncStatus === 'string' && rec.syncStatus.trim().length > 0 ? rec.syncStatus.trim() : null;
  const lastSyncedAt =
    typeof rec.lastSyncedAt === 'string' && rec.lastSyncedAt.trim().length > 0 ? rec.lastSyncedAt.trim() : null;
  const lastSyncError =
    typeof rec.lastSyncError === 'string' && rec.lastSyncError.trim().length > 0
      ? rec.lastSyncError.trim()
      : null;
  return { syncStatus, lastSyncedAt, lastSyncError };
}

export function resolveContextDocumentSource(doc: ContextDocumentRow): ContextDocumentSourceDescriptor {
  const kind = inferSourceKind(doc.sourceType);

  if (kind === 'local') {
    if (!doc.storageKey) throw new Error('Local document is missing storageKey');
    return { kind: 'local', storageKey: doc.storageKey };
  }

  const data = asRecord(doc.data);
  const source = asRecord(data.source);

  if (kind === 'google_drive') {
    const fileId = getDataString(source, 'fileId') ?? getDataString(source, 'file_id');
    if (!fileId) throw new Error('Google Drive document is missing fileId');
    const connectorAccountId =
      getDataNullableString(source, 'connectorAccountId') ??
      getDataNullableString(source, 'connector_account_id');
    const mimeType = getDataNullableString(source, 'mimeType') ?? getDataNullableString(source, 'mime_type');
    const exportMimeType =
      getDataNullableString(source, 'exportMimeType') ?? getDataNullableString(source, 'export_mime_type');
    const name = getDataNullableString(source, 'name');
    return { kind: 'google_drive', fileId, connectorAccountId, mimeType, exportMimeType, name };
  }

  // Reserved for BR-16b.
  if (kind === 'sharepoint') return { kind: 'sharepoint' };
  if (kind === 'onedrive') return { kind: 'onedrive' };

  throw new Error('Unsupported document source');
}

async function resolveGoogleDriveAccessToken(
  source: Extract<ContextDocumentSourceDescriptor, { kind: 'google_drive' }>,
  access: ContextDocumentAccess | null | undefined,
): Promise<string> {
  if (access?.mode === 'user') {
    const token = await resolveGoogleDriveTokenSecret({
      userId: access.userId,
      workspaceId: access.workspaceId,
    });
    if (!token?.accessToken) throw new Error('Google Drive account is not connected');
    return token.accessToken;
  }

  const connectorAccountId =
    access?.mode === 'connector_account' ? access.connectorAccountId : source.connectorAccountId;
  if (!connectorAccountId) {
    throw new Error('Google Drive document access requires a connector account');
  }
  const token = await resolveGoogleDriveTokenSecretByAccountId({ connectorAccountId });
  if (!token?.accessToken) throw new Error('Google Drive connector account is not connected');
  return token.accessToken;
}

function toMinimalGoogleDriveFileMetadata(
  source: Extract<ContextDocumentSourceDescriptor, { kind: 'google_drive' }>,
): GoogleDriveFileMetadata | null {
  const name = source.name?.trim() || '';
  const mimeType = source.mimeType?.trim() || '';
  if (!name || !mimeType) return null;
  return {
    id: source.fileId,
    name,
    mimeType,
    webViewLink: null,
    webContentLink: null,
    iconLink: null,
    modifiedTime: null,
    version: null,
    size: null,
    md5Checksum: null,
    trashed: false,
    driveId: null,
  };
}

export async function loadContextDocumentContent(input: {
  document: ContextDocumentRow;
  access?: ContextDocumentAccess | null;
  fetchImpl?: typeof fetch;
  refreshSourceMetadata?: boolean;
}): Promise<LoadedContextDocumentContent> {
  const source = resolveContextDocumentSource(input.document);

  if (source.kind === 'local') {
    const bucket = getDocumentsBucketName();
    const bytes = await getObjectBytes({ bucket, key: source.storageKey });
    return {
      bytes,
      filename: input.document.filename,
      mimeType: input.document.mimeType,
      source,
      exportMimeType: null,
      resolvedMetadata: null,
    };
  }

  if (source.kind === 'google_drive') {
    const accessToken = await resolveGoogleDriveAccessToken(source, input.access);
    const stored = toMinimalGoogleDriveFileMetadata(source);
    const file =
      input.refreshSourceMetadata !== true && stored
        ? stored
        : await resolveGoogleDriveFileMetadata({
            accessToken,
            fileId: source.fileId,
            fetchImpl: input.fetchImpl,
          });
    const loaded = await loadGoogleDriveFileContent({
      accessToken,
      file,
      fetchImpl: input.fetchImpl,
    });
    return {
      bytes: loaded.bytes,
      filename: loaded.fileName,
      mimeType: loaded.mimeType,
      source,
      exportMimeType: loaded.exportMimeType,
      resolvedMetadata: file,
    };
  }

  if (source.kind === 'sharepoint' || source.kind === 'onedrive') {
    throw new Error(`Document source "${source.kind}" is not implemented yet`);
  }

  throw new Error('Unsupported document source');
}
