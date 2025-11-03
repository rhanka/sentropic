import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, ApiError } from '../../src/lib/utils/api';
import { resetFetchMock, mockFetchJsonOnce } from '../test-setup';

// Mock window.location
const mockLocation = {
  href: '',
  pathname: '/dashboard',
  search: '',
};

Object.defineProperty(window, 'location', {
  writable: true,
  value: mockLocation,
});

describe('API Utils - Authentication Redirects', () => {
  beforeEach(() => {
    resetFetchMock();
    mockLocation.href = '';
    mockLocation.pathname = '/dashboard';
    mockLocation.search = '';
  });

  describe('apiRequest - 401 redirect', () => {
    it('should redirect to login on 401 for protected route', async () => {
      mockLocation.pathname = '/dashboard';
      mockLocation.search = '?param=value';

      mockFetchJsonOnce({ error: 'Unauthorized' }, 401);

      await expect(apiRequest('/api/v1/companies')).rejects.toThrow();

      expect(mockLocation.href).toBe('/auth/login?returnUrl=%2Fdashboard%3Fparam%3Dvalue');
    });

    it('should not redirect on 401 for auth routes', async () => {
      mockLocation.pathname = '/auth/login';

      mockFetchJsonOnce({ error: 'Unauthorized' }, 401);

      await expect(apiRequest('/api/v1/auth/session')).rejects.toThrow();

      expect(mockLocation.href).toBe('');
    });

    it('should not redirect on 401 for home route', async () => {
      mockLocation.pathname = '/';

      mockFetchJsonOnce({ error: 'Unauthorized' }, 401);

      await expect(apiRequest('/api/v1/auth/session')).rejects.toThrow();

      expect(mockLocation.href).toBe('');
    });

    it('should preserve returnUrl in redirect', async () => {
      mockLocation.pathname = '/dossiers/123';
      mockLocation.search = '?tab=settings';

      mockFetchJsonOnce({ error: 'Unauthorized' }, 401);

      await expect(apiRequest('/api/v1/folders/123')).rejects.toThrow();

      expect(mockLocation.href).toBe('/auth/login?returnUrl=%2Fdossiers%2F123%3Ftab%3Dsettings');
    });

    it('should throw ApiError with correct message', async () => {
      mockLocation.pathname = '/dashboard';

      mockFetchJsonOnce({ 
        error: 'Unauthorized',
        message: 'Session expired' 
      }, 401);

      try {
        await apiRequest('/api/v1/companies');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).message).toBe('Session expired');
        expect((error as ApiError).status).toBe(401);
      }
    });

    it('should handle non-401 errors without redirect', async () => {
      mockLocation.pathname = '/dashboard';

      mockFetchJsonOnce({ error: 'Not Found' }, 404);

      await expect(apiRequest('/api/v1/companies/999')).rejects.toThrow();

      expect(mockLocation.href).toBe('');
    });
  });
});


