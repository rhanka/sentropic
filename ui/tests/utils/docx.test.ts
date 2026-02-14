import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../../src/lib/config';
import { resetFetchMock } from '../test-setup';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const scopedWorkspaceIdMock = vi.fn();

vi.mock('../../src/lib/utils/api', () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
  apiPost: (...args: unknown[]) => apiPostMock(...args),
}));

vi.mock('../../src/lib/stores/workspaceScope', () => ({
  getScopedWorkspaceIdForUser: () => scopedWorkspaceIdMock(),
}));

import {
  downloadCompletedDocxJob,
  startDocxGeneration,
  waitForDocxJobCompletion,
} from '../../src/lib/utils/docx';

describe('docx utils', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    scopedWorkspaceIdMock.mockReset();
    resetFetchMock();
  });

  it('startDocxGeneration posts the expected payload to scoped endpoint', async () => {
    scopedWorkspaceIdMock.mockReturnValue('ws-42');
    apiPostMock.mockResolvedValue({
      success: true,
      jobId: 'job-1',
      status: 'pending',
      queueClass: 'publishing',
      streamId: 'job_job-1',
    });

    const payload = {
      templateId: 'executive-synthesis-multipage' as const,
      entityType: 'folder' as const,
      entityId: 'folder-1',
      provided: { dashboardImage: { dataBase64: 'abc' } },
      controls: {},
    };
    await startDocxGeneration(payload);

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).toHaveBeenCalledWith('/docx/generate?workspace_id=ws-42', payload);
  });

  it('waitForDocxJobCompletion polls until completed', async () => {
    scopedWorkspaceIdMock.mockReturnValue('ws-42');
    apiGetMock
      .mockResolvedValueOnce({ id: 'job-1', status: 'pending' })
      .mockResolvedValueOnce({ id: 'job-1', status: 'processing' })
      .mockResolvedValueOnce({ id: 'job-1', status: 'completed' });

    const result = await waitForDocxJobCompletion('job-1', { timeoutMs: 300, intervalMs: 1 });

    expect(result).toEqual({ id: 'job-1', status: 'completed' });
    expect(apiGetMock).toHaveBeenCalledTimes(3);
    expect(apiGetMock).toHaveBeenNthCalledWith(1, '/queue/jobs/job-1?workspace_id=ws-42');
    expect(apiGetMock).toHaveBeenNthCalledWith(2, '/queue/jobs/job-1?workspace_id=ws-42');
    expect(apiGetMock).toHaveBeenNthCalledWith(3, '/queue/jobs/job-1?workspace_id=ws-42');
  });

  it('waitForDocxJobCompletion throws on timeout', async () => {
    scopedWorkspaceIdMock.mockReturnValue('ws-42');
    apiGetMock.mockResolvedValue({ id: 'job-1', status: 'processing' });

    await expect(
      waitForDocxJobCompletion('job-1', { timeoutMs: 5, intervalMs: 2 })
    ).rejects.toThrow('DOCX generation timed out');
  });

  it('downloadCompletedDocxJob extracts filename from content-disposition', async () => {
    scopedWorkspaceIdMock.mockReturnValue('ws-42');
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['docx']), {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="executive.docx"',
        },
      })
    );

    const originalCreateObjectURL = (URL as { createObjectURL?: (obj: Blob) => string }).createObjectURL;
    const originalRevokeObjectURL = (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL;
    const createObjectURLMock = vi.fn().mockReturnValue('blob:test-url');
    const revokeObjectURLMock = vi.fn();
    (URL as { createObjectURL?: (obj: Blob) => string }).createObjectURL = createObjectURLMock;
    (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL = revokeObjectURLMock;
    const originalCreateElement = document.createElement.bind(document);
    let createdLink: HTMLAnchorElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string): HTMLElement => {
      const el = originalCreateElement(tagName) as HTMLElement;
      if (tagName.toLowerCase() === 'a') {
        createdLink = el as HTMLAnchorElement;
        vi.spyOn(createdLink, 'click').mockImplementation(() => {});
      }
      return el;
    }) as typeof document.createElement);

    try {
      await downloadCompletedDocxJob('job-1', 'fallback.docx');
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE_URL}/docx/jobs/job-1/download?workspace_id=ws-42`,
        { method: 'GET', credentials: 'include' }
      );
      expect(createdLink?.download).toBe('executive.docx');
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test-url');
    } finally {
      if (originalCreateObjectURL) {
        (URL as { createObjectURL?: (obj: Blob) => string }).createObjectURL = originalCreateObjectURL;
      } else {
        delete (URL as { createObjectURL?: (obj: Blob) => string }).createObjectURL;
      }
      if (originalRevokeObjectURL) {
        (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL = originalRevokeObjectURL;
      } else {
        delete (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL;
      }
    }
  });
});
