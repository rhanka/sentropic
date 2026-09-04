import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { tenants, workspaces } from '../../src/db/schema';
import {
  createResourcesTransportRouter,
  RESOURCE_PATHS,
  RESOURCE_ROUTES,
  type ResourceProjectionPort,
  type ResourcesNamespacePorts,
} from '../../src/routes/namespaces/resources-module';
import { getResourceDispatcher } from '../../src/services/resource-plane';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const pass: MiddlewareHandler = async (_context, next) => next();
const principal = {
  userId: 'user-a',
  scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
  context: {
    userId: 'user-a',
    role: 'editor',
    workspaceType: 'ai-priorities',
    roles: ['editor'],
    permissions: [],
    permissionMode: 'allowlist' as const,
    allowedTools: [],
  },
};
const request = (app: Hono, path: string, body: unknown) => app.request(`/api/v1${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const createProjection = (): ResourceProjectionPort => ({
  dispatch: vi.fn(async ({ verb, target, args, principal: resolved }) => ({
    verb,
    target,
    args,
    scope: resolved.scope,
    ...(verb === 'read'
      ? { provenance: { provider: 'fixture', trust: 'external', origin: 'test' } }
      : {}),
  })),
});
const createPorts = (resources = createProjection()): ResourcesNamespacePorts => ({
  resources,
  principal: { resolve: vi.fn(async () => principal) },
  authenticate: pass,
});

describe('cluster mesh resources transport', () => {
  it('requires injected ports and exposes only six exact POST routes', async () => {
    expect(() => createResourcesTransportRouter({
      ...createPorts(), resources: undefined,
    } as unknown as ResourcesNamespacePorts)).toThrowError('resources product ports are unavailable');
    const router = createResourcesTransportRouter(createPorts());
    expect(router.routes.map(({ method, path }) => [method, path])).toEqual(RESOURCE_ROUTES);
    expect(RESOURCE_PATHS).toHaveLength(6);
    expect(RESOURCE_PATHS).not.toContain('/*');

    const source = readFileSync(
      new URL('../../src/routes/namespaces/resources.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
    const app = new Hono().route('/api/v1', router);
    expect((await app.request('/api/v1/resources/list')).status).toBe(404);
    expect((await app.request('/api/v1/resources/unknown', { method: 'POST' })).status).toBe(404);
  });

  it('projects every validated verb with server-resolved principal and provenance intact', async () => {
    const resources = createProjection();
    const app = new Hono().route('/api/v1', createResourcesTransportRouter(createPorts(resources)));
    const cases = [
      ['/resources/list', { path: '/', limit: 4 }],
      ['/resources/stat', { path: '/skills/planner' }],
      ['/resources/read', { ref: { provider: 'catalog', type: 'skill', id: 'skill:foundation:planner' }, maxBytes: 80 }],
      ['/resources/grep', { path: '/skills', query: 'planner', limit: 2 }],
      ['/resources/edit', { path: '/canvas/draft', etag: 'v1', content: 'updated', contentType: 'text/plain' }],
      ['/resources/invoke', { path: '/tools/planner', args: { topic: 'mesh' }, idempotencyKey: 'invoke-1' }],
    ] as const;

    for (const [path, body] of cases) {
      const response = await request(app, path, body);
      expect(response.status, path).toBe(200);
      const result = (await response.json()).result;
      expect(result.scope).toEqual(principal.scope);
      if (path === '/resources/read') {
        expect(result.provenance).toEqual({ provider: 'fixture', trust: 'external', origin: 'test' });
      }
    }
    expect(resources.dispatch).toHaveBeenCalledTimes(6);
    expect(resources.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      verb: 'invoke',
      target: { path: '/tools/planner' },
      args: { args: { topic: 'mesh' }, idempotencyKey: 'invoke-1' },
      principal,
    }));
  });

  it('rejects caller scope and malformed effect intent before dispatch', async () => {
    const resources = createProjection();
    const app = new Hono().route('/api/v1', createResourcesTransportRouter(createPorts(resources)));
    const scoped = await request(app, '/resources/read', {
      ref: {
        provider: 'catalog', type: 'skill', id: 'skill:foundation:planner',
        scope: { tenantId: 'tenant-b', workspaceId: 'workspace-b' },
      },
    });
    const invalidInvoke = await request(app, '/resources/invoke', {
      path: '/tools/planner', args: 'not-an-object',
    });
    expect(scoped.status).toBe(400);
    expect(invalidInvoke.status).toBe(400);
    expect(resources.dispatch).not.toHaveBeenCalled();
  });
});

const resourceKey = { compositionRoot: 'product' as const, namespace: '/resources' as const };
const resourceCutovers = new PostgresClusterMeshCutoverStore();
const clearResourceCutover = async () => {
  await db.delete(clusterMeshNamespaceCutovers).where(and(
    eq(clusterMeshNamespaceCutovers.compositionRoot, resourceKey.compositionRoot),
    eq(clusterMeshNamespaceCutovers.namespace, resourceKey.namespace),
  ));
};

describe('cluster mesh resources product scope', () => {
  let user: TestUser;
  let outsider: TestUser;
  let outsiderTenant: string;

  beforeEach(async () => {
    await clearResourceCutover();
    user = await createAuthenticatedUser('editor');
    outsider = await createAuthenticatedUser('editor');
    outsiderTenant = `resources-${crypto.randomUUID()}`;
    await db.insert(tenants).values({ id: outsiderTenant, name: outsiderTenant, status: 'active' });
    await db.update(workspaces).set({ tenantId: outsiderTenant })
      .where(eq(workspaces.id, outsider.workspaceId!));
  });

  afterEach(async () => {
    await clearResourceCutover();
    await cleanupAuthData();
    await db.delete(workspaces).where(inArray(workspaces.id, [user.workspaceId!, outsider.workspaceId!]));
    await db.delete(tenants).where(eq(tenants.id, outsiderTenant));
  });

  it('matches canonical dispatcher reads and keeps catalog effects unavailable', async () => {
    const scope = { tenantId: 'sentropic', workspaceId: user.workspaceId! };
    const canonical = {
      scope,
      context: {
        userId: user.id,
        role: 'editor',
        workspaceType: 'ai-priorities',
        roles: ['editor'], permissions: [], permissionMode: 'allowlist' as const, allowedTools: [],
      },
    };
    const dispatcher = getResourceDispatcher();
    const root = await authenticatedRequest(
      productApp, 'POST', '/api/v1/resources/list', user.sessionToken!, { path: '/' },
    );
    expect(root.status).toBe(200);
    await expect(root.json()).resolves.toEqual({ result: dispatcher.listRoot(canonical) });

    const dir = (await dispatcher.resolvePath('/skills', canonical))!;
    const directList = await dispatcher.list(dir, { limit: 1 }, canonical);
    expect(directList.entries.length).toBeGreaterThan(0);
    const list = await authenticatedRequest(
      productApp, 'POST', '/api/v1/resources/list', user.sessionToken!,
      { path: '/skills', limit: 1 },
    );
    await expect(list.json()).resolves.toEqual({ result: directList });
    const entry = directList.entries[0];
    const wireRef = {
      provider: entry.ref.provider, type: entry.ref.type, id: entry.ref.id, etag: entry.ref.etag,
    };
    for (const [verb, body, direct] of [
      ['stat', { ref: wireRef }, await dispatcher.stat(entry.ref, canonical)],
      ['read', { ref: wireRef, maxBytes: 128 }, await dispatcher.read(entry.ref, { maxBytes: 128 }, canonical)],
      ['grep', { path: '/skills', query: entry.name, limit: 2 },
        await dispatcher.grep(dir, { query: entry.name, limit: 2 }, canonical)],
    ] as const) {
      const response = await authenticatedRequest(
        productApp, 'POST', `/api/v1/resources/${verb}`, user.sessionToken!, body,
      );
      expect(response.status, verb).toBe(200);
      await expect(response.json()).resolves.toEqual({ result: direct });
    }
    expect((await authenticatedRequest(
      productApp, 'POST', '/api/v1/resources/edit', user.sessionToken!,
      { ref: wireRef, content: 'no mutation' },
    )).status).toBe(403);
    expect((await authenticatedRequest(
      productApp, 'POST', '/api/v1/resources/invoke', user.sessionToken!,
      { ref: wireRef, args: {} },
    )).status).toBe(422);
  });

  it('denies caller-selected cross-tenant workspace and ref scope without leaking', async () => {
    const outside = await authenticatedRequest(
      productApp, 'POST',
      `/api/v1/resources/list?workspace_id=${outsider.workspaceId}`,
      user.sessionToken!, { path: '/' },
    );
    expect(outside.status).toBe(404);
    await expect(outside.json()).resolves.toEqual({ message: 'Not found' });

    const injected = await authenticatedRequest(
      productApp, 'POST', '/api/v1/resources/read', user.sessionToken!,
      { ref: { provider: 'catalog', type: 'skill', id: 'skill:foundation:planner',
        scope: { tenantId: outsiderTenant, workspaceId: outsider.workspaceId } } },
    );
    expect(injected.status).toBe(400);
    await expect(injected.json()).resolves.toEqual({ error: 'resource_request_refused' });
  });
});
