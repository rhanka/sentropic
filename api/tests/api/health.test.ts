import { describe, it, expect } from 'vitest';
import { apiRequest } from '../utils/test-helpers';

describe('Health API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await apiRequest('/api/v1/health');
      
      expect(response.ok).toBe(true);
      expect(response.data.status).toBe('ok');
    });
  });
});
