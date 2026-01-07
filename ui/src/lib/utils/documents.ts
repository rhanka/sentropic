import { API_BASE_URL } from '$lib/config';

export type DocumentContextType = 'organization' | 'folder' | 'usecase';

function getUrlBaseForBrowser(): string {
  // In production Docker UI build, API_BASE_URL is typically "/api/v1" (relative)
  // and is proxied by nginx. In dev, it can be absolute ("http://localhost:8787/api/v1").
  // `new URL(relative)` throws unless a base is provided.
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  // Fallback for non-browser environments (tests / SSR). Should not be used for real requests.
  return 'http://localhost';
}

export type ContextDocumentItem = {
  id: string;
  context_type: DocumentContextType;
  context_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  summary?: string | null;
  summary_lang?: string | null;
  created_at?: string;
  updated_at?: string | null;
  job_id?: string;
};

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
  const res = await fetch(`${API_BASE_URL}/documents?${qs.toString()}`, {
    credentials: 'include',
    cache: 'no-store',
  });
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

  const url = new URL(`${API_BASE_URL}/documents`, getUrlBaseForBrowser());
  if (params.workspaceId) url.searchParams.set('workspace_id', params.workspaceId);

  const res = await fetch(url.toString(), {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `HTTP ${res.status}`);
  return res.json();
}

export function getDownloadUrl(params: { documentId: string; workspaceId?: string | null }): string {
  const url = new URL(`${API_BASE_URL}/documents/${params.documentId}/content`, getUrlBaseForBrowser());
  if (params.workspaceId) url.searchParams.set('workspace_id', params.workspaceId);
  return url.toString();
}

export async function deleteDocument(params: { documentId: string; workspaceId?: string | null }): Promise<void> {
  const url = new URL(`${API_BASE_URL}/documents/${params.documentId}`, getUrlBaseForBrowser());
  if (params.workspaceId) url.searchParams.set('workspace_id', params.workspaceId);
  const res = await fetch(url.toString(), { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `HTTP ${res.status}`);
}


