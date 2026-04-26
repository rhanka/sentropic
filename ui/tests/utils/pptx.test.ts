import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../../src/lib/config';
import { resetFetchMock } from '../test-setup';

const scopedWorkspaceIdMock = vi.fn();

vi.mock('../../src/lib/stores/workspaceScope', () => ({
  getScopedWorkspaceIdForUser: () => scopedWorkspaceIdMock(),
}));

describe('pptx utils', () => {
  beforeEach(() => {
    scopedWorkspaceIdMock.mockReset();
    resetFetchMock();
  });

  it('exports downloadCompletedPptxJob and uses the pptx download route', async () => {
    scopedWorkspaceIdMock.mockReturnValue('ws-42');
    const modulePath = '../../src/lib/utils/pptx';
    const module = await import(/* @vite-ignore */ modulePath).catch(() => undefined);
    expect(typeof module?.downloadCompletedPptxJob).toBe('function');
    if (typeof module?.downloadCompletedPptxJob !== 'function') return;

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['pptx']), {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="roadmap-deck.pptx"',
        },
      })
    );

    const originalCreateObjectURL = (URL as { createObjectURL?: (obj: Blob) => string }).createObjectURL;
    const originalRevokeObjectURL = (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL;
    const createObjectURLMock = vi.fn().mockReturnValue('blob:pptx-url');
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
      await module.downloadCompletedPptxJob('job-1', 'fallback.pptx');
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE_URL}/pptx/jobs/job-1/download?workspace_id=ws-42`,
        { method: 'GET', credentials: 'include' }
      );
      expect(createdLink?.download).toBe('roadmap-deck.pptx');
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:pptx-url');
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
