import { and, eq, like } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import {
  appInstances,
  appTemplates,
  clusterMeshNamespaceCutovers,
} from '../../src/db/control-schema';
import {
  APP_PATHS,
  APP_ROUTES,
  createAppsTransportRouter,
  type AppsControlPlanePort,
  type AppsNamespacePorts,
} from '../../src/routes/namespaces/apps-module';
import { appControlPlane } from '../../src/services/app-control-plane';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

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

const key = { compositionRoot: 'product' as const, namespace: '/apps' as const };
const slugPrefix = 'test-cm-apps-';
const tenantId = 'test-cm-apps-tenant';

const clearProductState = async () => {
  await db.delete(appInstances).where(eq(appInstances.tenantId, tenantId));
  await db.delete(appTemplates).where(like(appTemplates.appSlug, `${slugPrefix}%`));
  await db.delete(clusterMeshNamespaceCutovers).where(and(
    eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
    eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
  ));
};

describe('cluster mesh apps product authority', () => {
  let admin: TestUser;

  beforeEach(async () => {
    await clearProductState();
    admin = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await clearProductState();
    await cleanupAuthData();
  });

  it('matches direct canonical template and instance reads over seeded state', async () => {
    const template = await appControlPlane.createTemplate({
      appSlug: `${slugPrefix}reads`, version: '1.0.0', blueprint: { packages: ['core'] },
    });
    await appControlPlane.publishTemplate(template.id);
    const instance = await appControlPlane.createInstance({
      templateFamilyId: template.familyId,
      templateVersion: template.version,
      tenantId,
    });
    const directTemplates = await appControlPlane.listTemplates({ familyId: template.familyId });
    const directInstance = await appControlPlane.getInstance(instance.id);

    const templatesResponse = await authenticatedRequest(
      productApp,
      'GET',
      `/api/v1/apps/templates?familyId=${template.familyId}`,
      admin.sessionToken!,
    );
    const instanceResponse = await authenticatedRequest(
      productApp, 'GET', `/api/v1/apps/instances/${instance.id}`, admin.sessionToken!,
    );
    expect({ status: templatesResponse.status, body: await templatesResponse.json() }).toEqual({
      status: 200, body: { items: JSON.parse(JSON.stringify(directTemplates)) },
    });
    expect({ status: instanceResponse.status, body: await instanceResponse.json() }).toEqual({
      status: 200, body: { item: JSON.parse(JSON.stringify(directInstance)) },
    });
  });

  it('performs one real durable template and instance lifecycle through the selected route', async () => {
    const createTemplate = await authenticatedRequest(
      productApp, 'POST', '/api/v1/apps/templates', admin.sessionToken!,
      { appSlug: `${slugPrefix}lifecycle`, version: '1.0.0', blueprint: { packages: [] } },
    );
    expect(createTemplate.status).toBe(201);
    const template = (await createTemplate.json()).item;
    const publish = await authenticatedRequest(
      productApp, 'POST', `/api/v1/apps/templates/${template.id}/publish`, admin.sessionToken!,
    );
    expect((await publish.json()).item.status).toBe('published');

    const createInstance = await authenticatedRequest(
      productApp, 'POST', '/api/v1/apps/instances', admin.sessionToken!,
      { templateFamilyId: template.familyId, templateVersion: '1.0.0', tenantId },
    );
    expect(createInstance.status).toBe(201);
    const instance = (await createInstance.json()).item;
    const activate = await authenticatedRequest(
      productApp,
      'POST',
      `/api/v1/apps/instances/${instance.id}/transition`,
      admin.sessionToken!,
      { status: 'active' },
    );
    expect((await activate.json()).item.status).toBe('active');
    await expect(db.select().from(appTemplates).where(eq(appTemplates.id, template.id)))
      .resolves.toHaveLength(1);
    await expect(db.select().from(appInstances).where(eq(appInstances.id, instance.id)))
      .resolves.toEqual([expect.objectContaining({ status: 'active', tenantId })]);
  });
});
