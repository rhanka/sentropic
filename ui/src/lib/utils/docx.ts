import { API_BASE_URL } from '$lib/config';
import { apiGet, apiPost } from '$lib/utils/api';
import { getScopedWorkspaceIdForUser } from '$lib/stores/workspaceScope';

type DocxGeneratePayload = {
  templateId: 'usecase-onepage' | 'executive-synthesis-multipage';
  entityType: 'usecase' | 'folder';
  entityId: string;
  provided?: Record<string, unknown>;
  controls?: Record<string, unknown>;
  options?: Record<string, unknown>;
};

type QueueJobStatus = {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
};

type GenerateDocxResponse = {
  success: boolean;
  jobId: string;
  status: string;
  queueClass: string;
  streamId: string;
};

function withWorkspaceScope(path: string): string {
  const scopedWorkspaceId = getScopedWorkspaceIdForUser();
  if (!scopedWorkspaceId) return path;
  const hasQuery = path.includes('?');
  return `${path}${hasQuery ? '&' : '?'}workspace_id=${encodeURIComponent(scopedWorkspaceId)}`;
}

async function waitForDocxJobCompletion(
  jobId: string,
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<QueueJobStatus> {
  const timeoutMs = opts?.timeoutMs ?? 10 * 60_000;
  const intervalMs = opts?.intervalMs ?? 1500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = await apiGet<QueueJobStatus>(withWorkspaceScope(`/queue/jobs/${jobId}`));
    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('DOCX generation timed out');
}

async function downloadCompletedDocxJob(jobId: string, fallbackFileName: string): Promise<void> {
  const scopedPath = withWorkspaceScope(`/docx/jobs/${jobId}/download`);
  const url = new URL(`${API_BASE_URL}${scopedPath}`, window.location.origin);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = (errorBody as { message?: string } | null)?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const disposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
  link.href = objectUrl;
  link.download = fileNameMatch?.[1] || fallbackFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export async function generateDocxAndDownload(
  payload: DocxGeneratePayload,
  fallbackFileName: string
): Promise<string> {
  const result = await apiPost<GenerateDocxResponse>(
    withWorkspaceScope('/docx/generate'),
    payload
  );

  if (!result?.jobId) {
    throw new Error('DOCX generation job was not created');
  }

  const finalJob = await waitForDocxJobCompletion(result.jobId);
  if (finalJob.status !== 'completed') {
    throw new Error(finalJob.error || 'DOCX generation failed');
  }

  await downloadCompletedDocxJob(result.jobId, fallbackFileName);
  return result.jobId;
}
