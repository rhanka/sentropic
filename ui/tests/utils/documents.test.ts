import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetFetchMock, mockFetchJsonOnce } from '../test-setup';
import { deleteDocument, getDownloadUrl, listDocuments, uploadDocument } from '../../src/lib/utils/documents';

describe('documents utils', () => {
  beforeEach(() => {
    resetFetchMock();
  });

  describe('listDocuments', () => {
    it('should call /documents with context_type/context_id and credentials + no-store', async () => {
      mockFetchJsonOnce({ items: [] });

      const res = await listDocuments({ contextType: 'folder', contextId: 'f_1' });

      expect(res.items).toEqual([]);
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('http://localhost:8787/api/v1/documents?');
      expect(String(url)).toContain('context_type=folder');
      expect(String(url)).toContain('context_id=f_1');
      expect(init?.credentials).toBe('include');
      expect(init?.cache).toBe('no-store');
    });

    it('should include workspace_id when provided', async () => {
      mockFetchJsonOnce({ items: [] });

      await listDocuments({ contextType: 'organization', contextId: 'org_1', workspaceId: 'ws_1' });

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('workspace_id=ws_1');
    });

    it('should surface API message on error', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'nope' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      );

      await expect(listDocuments({ contextType: 'usecase', contextId: 'uc_1' })).rejects.toThrow('nope');
    });

    it('should fallback to HTTP status when error body is not JSON', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));

      await expect(listDocuments({ contextType: 'usecase', contextId: 'uc_1' })).rejects.toThrow('HTTP 500');
    });
  });

  describe('uploadDocument', () => {
    it('should POST multipart form data to /documents and include workspace_id query when provided', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc_1', status: 'uploaded', job_id: 'job_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
      const res = await uploadDocument({
        contextType: 'folder',
        contextId: 'f_1',
        file,
        workspaceId: 'ws_1'
      });

      expect(res.id).toBe('doc_1');
      expect(res.job_id).toBe('job_1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('http://localhost:8787/api/v1/documents?workspace_id=ws_1');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      expect(init?.body).toBeInstanceOf(FormData);

      const form = init?.body as FormData;
      expect(form.get('context_type')).toBe('folder');
      expect(form.get('context_id')).toBe('f_1');
      expect(form.get('file')).toBe(file);
    });
  });

  describe('getDownloadUrl', () => {
    it('should build /documents/:id/content URL', () => {
      const url = getDownloadUrl({ documentId: 'doc_1' });
      expect(url).toBe('http://localhost:8787/api/v1/documents/doc_1/content');
    });

    it('should include workspace_id when provided', () => {
      const url = getDownloadUrl({ documentId: 'doc_1', workspaceId: 'ws_1' });
      expect(url).toBe('http://localhost:8787/api/v1/documents/doc_1/content?workspace_id=ws_1');
    });
  });

  describe('deleteDocument', () => {
    it('should DELETE /documents/:id and include credentials', async () => {
      mockFetchJsonOnce({}, 200);

      await deleteDocument({ documentId: 'doc_1' });

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('http://localhost:8787/api/v1/documents/doc_1');
      expect(init?.method).toBe('DELETE');
      expect(init?.credentials).toBe('include');
    });
  });
});


