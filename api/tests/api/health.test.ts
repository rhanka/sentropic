import { describe, it, expect } from 'vitest';
import { app } from '../../src/app';

describe('Health API', () => {
  describe('GET /', () => {
    it('should expose the Sentropic API name', async () => {
      const response = await app.request('/');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe('Sentropic API');
    });
  });

  describe('GET /health', () => {
    it('should return aggregate health without requiring authentication', async () => {
      const response = await app.request('/api/v1/health');
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('ok');
      expect(data.services).toEqual({
        database: 'ok',
        tables: { settings: 'accessible', jobQueue: 'accessible' },
      });
      expect(data.clusterMesh).toMatchObject({
        generation: { generationId: 'cluster-mesh-session-v1', status: 'active' },
        modules: expect.arrayContaining([{ namespace: '/health', enabled: true }]),
      });
      expect(data.readiness).toEqual({ status: 'ready', reasons: [] });
      expect((await app.request('/api/v1/health/health')).status).toBe(404);
    });
  });
});
