import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, ApiError } from '../../src/lib/utils/api';
import { API_BASE_URL } from '../../src/lib/config';
import { resetFetchMock, mockFetchJsonOnce } from '../test-setup';
import { setUser, clearUser } from '../../src/lib/stores/session';
import { setWorkspaceScope, workspaceScope } from '../../src/lib/stores/workspaceScope';

describe('API Utils', () => {
  beforeEach(() => {
    resetFetchMock();
    clearUser();
    localStorage.clear();
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });
  });

  describe('apiRequest - Error Handling', () => {
    it('should throw ApiError on 401 without redirect (handled by app)', async () => {
      mockFetchJsonOnce({ error: 'Unauthorized' }, 401);

      try {
        await apiRequest('/api/v1/organizations');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
        expect((error as ApiError).message).toBe('Unauthorized');
      }
    });

    it('should throw ApiError with correct message', async () => {
      mockFetchJsonOnce({ 
        error: 'Unauthorized',
        message: 'Session expired' 
      }, 401);

      try {
        await apiRequest('/api/v1/organizations');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).message).toBe('Session expired');
        expect((error as ApiError).status).toBe(401);
      }
    });

    it('should handle non-401 errors without redirect', async () => {
      mockFetchJsonOnce({ error: 'Not Found' }, 404);

      try {
        await apiRequest('/api/v1/organizations/999');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(404);
      }
    });
  });

  describe('apiRequest - workspace scoping', () => {
    it('sends X-App-Locale from the app locale selection', async () => {
      localStorage.setItem('locale', 'en-US');
      mockFetchJsonOnce({ items: [] });

      await apiRequest('/comments');

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [, init] = fetchMock.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-App-Locale']).toBe('en');
    });

    it('falls back to fr locale when localStorage locale is unknown', async () => {
      localStorage.setItem('locale', 'de-DE');
      mockFetchJsonOnce({ items: [] });

      await apiRequest('/comments');

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [, init] = fetchMock.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-App-Locale']).toBe('fr');
    });

    it('appends workspace_id for non-auth endpoints', async () => {
      setUser({ id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'editor' });
      setWorkspaceScope('ws-1');
      mockFetchJsonOnce({ items: [] });

      await apiRequest('/organizations');

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain(`${API_BASE_URL}/organizations`);
      expect(String(url)).toContain('workspace_id=ws-1');
    });

    it('appends workspace_id when query params exist', async () => {
      setUser({ id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'editor' });
      setWorkspaceScope('ws-1');
      mockFetchJsonOnce({ items: [] });

      await apiRequest('/comments?status=open');

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain(`${API_BASE_URL}/comments?`);
      expect(String(url)).toContain('status=open');
      expect(String(url)).toContain('workspace_id=ws-1');
    });

    it('does not override explicit workspace_id query', async () => {
      setUser({ id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'editor' });
      setWorkspaceScope('ws-1');
      mockFetchJsonOnce({ items: [] });

      await apiRequest('/comments?workspace_id=ws-2');

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain(`${API_BASE_URL}/comments?workspace_id=ws-2`);
      expect(String(url)).not.toContain('workspace_id=ws-1');
    });

    it('does not append workspace_id for /workspaces endpoints', async () => {
      setUser({ id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'editor' });
      setWorkspaceScope('ws-1');
      mockFetchJsonOnce({ items: [] });

      await apiRequest('/workspaces/ws-1/members');

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`${API_BASE_URL}/workspaces/ws-1/members`);
    });

    it('does not append workspace_id for auth endpoints', async () => {
      setUser({ id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'editor' });
      setWorkspaceScope('ws-1');
      mockFetchJsonOnce({ ok: true });

      await apiRequest('/auth/session');

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`${API_BASE_URL}/auth/session`);
    });
  });
});
