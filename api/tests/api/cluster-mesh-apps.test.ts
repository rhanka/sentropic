import { readFileSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  APP_PATHS,
  APP_ROUTES,
  createAppsTransportRouter,
  type AppsControlPlanePort,
  type AppsNamespacePorts,
} from '../../src/routes/namespaces/apps-module';

const pass: MiddlewareHandler = async (_context, next) => next();
const templates = [{ id: 'template-1', appSlug: 'code', status: 'published' }];
const instances = [{ id: 'instance-1', tenantId: 'tenant-1', status: 'active' }];

const createControlPlane = (): AppsControlPlanePort => ({
  createTemplate: vi.fn(async (input) => ({ id: 'template-new', status: 'draft', ...input })),
  updateDraft: vi.fn(async (id, patch) => ({ id, status: 'draft', ...patch })),
  publishTemplate: vi.fn(async (id) => ({ id, status: 'published' })),
  deprecateTemplate: vi.fn(async (id) => ({ id, status: 'deprecated' })),
  getTemplate: vi.fn(async (id) => templates.find((item) => item.id === id) ?? null),
  listTemplates: vi.fn(async () => templates),
  createInstance: vi.fn(async (input) => ({ id: 'instance-new', status: 'provisioning', ...input })),
  transitionInstance: vi.fn(async (id, status) => ({ id, status })),
  getInstance: vi.fn(async (id) => instances.find((item) => item.id === id) ?? null),
  listInstances: vi.fn(async () => instances),
});

const createPorts = (controlPlane = createControlPlane()): AppsNamespacePorts => ({
  controlPlane,
  authenticate: pass,
  authorizeAdminApp: pass,
  mapError(error) {
    if (error instanceof Error && error.message.endsWith('_not_found')) {
      return { status: 404, error: error.message };
    }
    return { status: 400, error: 'invalid_app_request' };
  },
});

describe('cluster mesh apps transport', () => {
  it('requires injected authority and enumerates exact non-wildcard routes', () => {
    expect(() => createAppsTransportRouter({
      ...createPorts(),
      controlPlane: undefined,
    } as unknown as AppsNamespacePorts)).toThrowError('apps product ports are unavailable');
    const routes = createAppsTransportRouter(createPorts()).routes.map(({ method, path }) => [method, path]);
    expect(routes).toEqual(APP_ROUTES);
    expect(APP_PATHS).toHaveLength(7);
    expect(APP_PATHS).not.toContain('/*');

    const source = readFileSync(
      new URL('../../src/routes/namespaces/apps.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
  });

  it('preserves deterministic reads and forwards only validated lifecycle intent', async () => {
    const controlPlane = createControlPlane();
    const app = new Hono().route('/api/v1', createAppsTransportRouter(createPorts(controlPlane)));

    const list = await app.request('/api/v1/apps/templates?status=published&appSlug=code');
    expect(await list.json()).toEqual({ items: templates });
    expect(controlPlane.listTemplates).toHaveBeenCalledWith({ status: 'published', appSlug: 'code' });
    const instance = await app.request('/api/v1/apps/instances/instance-1');
    expect(await instance.json()).toEqual({ item: instances[0] });

    const create = await app.request('/api/v1/apps/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appSlug: 'code', version: '1.0.0', blueprint: { packages: [] } }),
    });
    expect(create.status).toBe(201);
    expect(controlPlane.createTemplate).toHaveBeenCalledWith({
      appSlug: 'code', version: '1.0.0', blueprint: { packages: [] },
    });

    const invalid = await app.request('/api/v1/apps/instances/instance-1/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });
    expect(invalid.status).toBe(400);
    expect(controlPlane.transitionInstance).not.toHaveBeenCalled();
  });
});
