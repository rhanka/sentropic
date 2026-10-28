import { describe, expect, it } from 'vitest';
import { startContentServer } from '../src/index';

describe('standalone content listener', () => {
  it('should start default-closed without database, storage or signing credentials', async () => {
    const server = await startContentServer({ env: {}, hostname: '127.0.0.1', port: 0 });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('TCP listener required');
      const origin = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${origin}/healthz`)).status).toBe(200);
      const response = await fetch(origin);
      expect(response.status).toBe(404);
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('should refuse enabled serving without explicit private configuration before listening', async () => {
    await expect(startContentServer({ env: { APP_ARTIFACT_CONTENT_ENABLED: '1' }, port: 0 })).rejects.toThrow(/required/);
  });
});
