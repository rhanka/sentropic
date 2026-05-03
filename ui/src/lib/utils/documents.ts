import { API_BASE_URL } from '$lib/config';
import { getApiAuthToken, getApiBaseUrl } from '$lib/core/api-client';

export type DocumentContextType = 'organization' | 'folder' | 'initiative' | 'chat_session';
export const DOCUMENT_UPLOAD_ACCEPT =
  'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown,text/plain,application/json,.zip,.tar.gz,.tgz,application/zip,application/x-zip-compressed,application/gzip,application/x-gzip,application/x-tar,application/tar';

function getUrlBaseForBrowser(): string {
  // In production Docker UI build, API_BASE_URL is typically "/api/v1" (relative)
  // and is proxied by nginx. In dev, it can be absolute ("http://localhost:8787/api/v1").
  // `new URL(relative)` throws unless a base is provided.
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  // Fallback for non-browser environments (tests / SSR). Should not be used for real requests.
  return 'http://localhost';
}

function getDocumentsApiBaseUrl(): string {
  return getApiBaseUrl() ?? API_BASE_URL;
}

function withAuth(init: RequestInit = {}): RequestInit {
  const authToken = getApiAuthToken();
  return {
    ...init,
    credentials: authToken ? 'omit' : 'include',
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers ?? {}),
    },
  };
}

export type ContextDocumentItem = {
  id: string;
  source_type?: 'local' | 'google_drive' | 'sharepoint' | 'onedrive';
  context_type: DocumentContextType;
  context_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  indexing_skipped?: boolean;
  summary?: string | null;
  summary_lang?: string | null;
  created_at?: string;
  updated_at?: string | null;
  job_id?: string;
};

const GOOGLE_WORKSPACE_MIME_LABELS: Record<string, string> = {
  'application/vnd.google-apps.document': 'Google Docs',
  'application/vnd.google-apps.spreadsheet': 'Google Sheets',
  'application/vnd.google-apps.presentation': 'Google Slides',
};

export function getDocumentMimeLabel(mimeType: string): string {
  return GOOGLE_WORKSPACE_MIME_LABELS[mimeType] ?? mimeType;
}

export function shouldHideDocumentSize(
  item: Pick<ContextDocumentItem, 'source_type' | 'mime_type'>,
): boolean {
  return item.source_type === 'google_drive' && item.mime_type in GOOGLE_WORKSPACE_MIME_LABELS;
}

export async function listDocuments(params: {
  contextType: DocumentContextType;
  contextId: string;
  workspaceId?: string | null;
}): Promise<{ items: ContextDocumentItem[] }> {
  const qs = new URLSearchParams({
    context_type: params.contextType,
    context_id: params.contextId,
  });
  if (params.workspaceId) qs.set('workspace_id', params.workspaceId);
  const res = await fetch(`${getDocumentsApiBaseUrl()}/documents?${qs.toString()}`, withAuth({
    cache: 'no-store',
  }));
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `HTTP ${res.status}`);
  return res.json();
}

export async function uploadDocument(params: {
  contextType: DocumentContextType;
  contextId: string;
  file: File;
  workspaceId?: string | null;
}): Promise<{ id: string; status: string; job_id?: string }> {
  const form = new FormData();
  form.set('context_type', params.contextType);
  form.set('context_id', params.contextId);
  form.set('file', params.file);

  const url = new URL(`${getDocumentsApiBaseUrl()}/documents`, getUrlBaseForBrowser());
  if (params.workspaceId) url.searchParams.set('workspace_id', params.workspaceId);

  const res = await fetch(url.toString(), withAuth({
    method: 'POST',
    body: form,
  }));
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `HTTP ${res.status}`);
  return res.json();
}

export function getDownloadUrl(params: { documentId: string; workspaceId?: string | null }): string {
  const url = new URL(`${getDocumentsApiBaseUrl()}/documents/${params.documentId}/content`, getUrlBaseForBrowser());
  if (params.workspaceId) url.searchParams.set('workspace_id', params.workspaceId);
  return url.toString();
}

export async function deleteDocument(params: { documentId: string; workspaceId?: string | null }): Promise<void> {
  const url = new URL(`${getDocumentsApiBaseUrl()}/documents/${params.documentId}`, getUrlBaseForBrowser());
  if (params.workspaceId) url.searchParams.set('workspace_id', params.workspaceId);
  const res = await fetch(url.toString(), withAuth({ method: 'DELETE' }));
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `HTTP ${res.status}`);
}
