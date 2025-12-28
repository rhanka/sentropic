import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, ApiError } from '../../src/lib/utils/api';
import { resetFetchMock, mockFetchJsonOnce } from '../test-setup';

describe('API Utils', () => {
  beforeEach(() => {
    resetFetchMock();
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
});
