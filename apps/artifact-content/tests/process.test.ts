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

  it('should refuse db+s3 placement without object-store env', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { writeFileSync, rmSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'w3b-key-'));
    const keyFile = join(dir, 'key');
    writeFileSync(keyFile, 'k'.repeat(64));
    try {
      await expect(startContentServer({ hostname: '127.0.0.1', port: 0, env: {
        APP_ARTIFACT_CONTENT_ENABLED: '1',
        DATABASE_URL: 'postgres://localhost:5432/postgres',
        APP_ARTIFACT_CONTENT_BASE_DOMAIN: 'content.example.test',
        APP_ARTIFACT_CONTENT_SIGNING_KEY_FILE: keyFile,
        APP_ARTIFACT_STORAGE_PLACEMENT: 'db+s3',
      } })).rejects.toThrow(/requires object-store env/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
