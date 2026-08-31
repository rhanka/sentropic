import { describe, expect, it, vi } from 'vitest';

import {
  createLlmMeshRouter,
  type CreateLlmMeshRouterOptions,
} from '../src/hono.js';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const createOptions = (): CreateLlmMeshRouterOptions => ({
  resolvePrincipal: async () => ({ userId: 'user-1', role: 'admin_app' }),
  catalog: {
    readCatalog: vi.fn(async () => json({ source: 'catalog' })),
    readUserSettings: vi.fn(async () => json({ source: 'settings' })),
    updateUserSettings: vi.fn(async () => json({ source: 'settings-update' })),
  },
  pool: {
    readAvailability: vi.fn(async () => json({ source: 'availability' })),
    readConnections: vi.fn(async () => json({ source: 'connections' })),
    updateTransportMode: vi.fn(async () => json({ source: 'transport-mode' })),
  },
  enrollment: {
    handle: vi.fn(async () => json({ source: 'enrollment' })),
  },
});

describe('createLlmMeshRouter', () => {
  it('projects catalog, pool, and user settings through injected ports', async () => {
    const options = createOptions();
    const router = createLlmMeshRouter(options);

    await expect((await router.request('/models/catalog')).json()).resolves.toEqual({ source: 'catalog' });
    await expect((await router.request('/models/provider-readiness')).json()).resolves.toEqual({ source: 'availability' });
    await expect((await router.request('/me/ai-settings')).json()).resolves.toEqual({ source: 'settings' });
    await expect((await router.request('/me/ai-settings', { method: 'PUT' })).json()).resolves.toEqual({ source: 'settings-update' });
    await expect((await router.request('/settings/provider-connections')).json()).resolves.toEqual({ source: 'connections' });
    await expect((await router.request('/settings/provider-connections/openai/mode', { method: 'POST' })).json()).resolves.toEqual({ source: 'transport-mode' });

    expect(options.catalog.readCatalog).toHaveBeenCalledOnce();
    expect(options.catalog.readUserSettings).toHaveBeenCalledOnce();
    expect(options.catalog.updateUserSettings).toHaveBeenCalledOnce();
    expect(options.pool.readAvailability).toHaveBeenCalledOnce();
    expect(options.pool.readConnections).toHaveBeenCalledOnce();
    expect(options.pool.updateTransportMode).toHaveBeenCalledWith(expect.objectContaining({
      principal: { userId: 'user-1', role: 'admin_app' },
      providerId: 'openai',
    }));
  });

  it('delegates a secret-bearing enrollment request opaquely to one custodian', async () => {
    const options = createOptions();
    let observedBody: unknown;
    options.enrollment.handle = vi.fn(async (input) => {
      observedBody = await input.request.json();
      return json({ accepted: true });
    });
    const router = createLlmMeshRouter(options);

    const response = await router.request('/settings/provider-connections/anthropic/enrollment/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'opaque-access', refreshToken: 'opaque-refresh' }),
    });

    expect(response.status).toBe(200);
    expect(observedBody).toEqual({ accessToken: 'opaque-access', refreshToken: 'opaque-refresh' });
    expect(options.enrollment.handle).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'anthropic',
      action: 'import',
      principal: { userId: 'user-1', role: 'admin_app' },
    }));
    expect(options.catalog.readCatalog).not.toHaveBeenCalled();
    expect(options.pool.readConnections).not.toHaveBeenCalled();
  });

  it('fails closed before any port when principal resolution fails', async () => {
    const options: CreateLlmMeshRouterOptions = {
      ...createOptions(),
      resolvePrincipal: async () => undefined,
    };
    const response = await createLlmMeshRouter(options).request('/models/catalog');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: 'Authentication required' });
    expect(options.catalog.readCatalog).not.toHaveBeenCalled();
  });
});
