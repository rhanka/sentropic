import { describe, it, expect } from 'vitest';
import { app } from '../../src/app';

describe('Health API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await app.request('/api/v1/health');
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('ok');
    });
  });
});
