import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createClusterMeshPlugin } from '../src/hono/plugin.js';
import { createClusterMeshRuntime } from '../src/runtime/generation.js';

describe('cluster mesh Hono plugin', () => {
  it('should mount only enabled namespace modules with injected neutral ports', async () => {
    const context = {
      async verify() {
        throw new Error('not invoked');
      },
    };
    const receipts = { append: vi.fn(async () => undefined) };
    const runtime = createClusterMeshRuntime({
      generationId: 'generation-1',
      config: { capacity: { poolSize: 2 } },
      context,
      registration: {
        async authorize() {
          return { ok: false, reason: 'missing_registration' } as const;
        },
      },
      receipts,
    });
    const createHealthRouter = vi.fn((ports) => {
      expect(ports).toEqual({ context, receipts });
      return new Hono().get('/', (c) => c.json({ status: 'ok' }));
    });
    const createAdminRouter = vi.fn(() => new Hono().get('/', (c) => c.text('disabled')));
    const plugin = createClusterMeshPlugin({
      runtime,
      namespaces: [
        { namespace: '/health', enabled: true, createRouter: createHealthRouter },
        { namespace: '/admin', enabled: false, createRouter: createAdminRouter },
      ],
    });

    const health = await plugin.request('/health');
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });
    expect((await plugin.request('/admin')).status).toBe(404);
    expect(createHealthRouter).toHaveBeenCalledOnce();
    expect(createAdminRouter).not.toHaveBeenCalled();
  });

  it('projects a namespace beneath a composition-root-specific path', async () => {
    const runtime = createClusterMeshRuntime({
      generationId: 'generation-1',
      config: { capacity: { poolSize: 1 } },
      context: { async verify() { throw new Error('not invoked'); } },
      registration: { async authorize() { return { ok: false, reason: 'missing_registration' }; } },
      receipts: { async append() {} },
    });
    const plugin = createClusterMeshPlugin({
      runtime,
      namespaces: [{
        namespace: '/session',
        enabled: true,
        createRouter: () => new Hono().get('/session', (c) => c.text('projected')),
      }],
      mounts: { '/session': '/' },
    });

    expect((await plugin.request('/session')).status).toBe(200);
    expect((await plugin.request('/session')).status).not.toBe(404);
  });
});
