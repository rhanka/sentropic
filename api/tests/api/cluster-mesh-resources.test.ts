import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  app as productApp,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
} from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { tenantMemberships, tenants, workspaces } from '../../src/db/schema';
import {
  createResourcesTransportRouter,
  createResourcesNamespaceModule,
  RESOURCE_PATHS,
  RESOURCE_ROUTES,
  RESOURCES_AUTHOR,
  RESOURCES_PREDECESSOR,
  type ResourceProjectionPort,
  type ResourcesNamespacePorts,
} from '../../src/routes/namespaces/resources-module';
import type { ResourcesCutoverControl } from '../../src/routes/namespaces/resources-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { getResourceDispatcher } from '../../src/services/resource-plane';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { productResourcesPorts } from '../../src/routes/namespaces/resources-product-ports';
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
const grantDefaultTenant = (userId: string) => db.insert(tenantMemberships).values({
  tenantId: 'sentropic', userId, status: 'approved', role: 'member',
}).onConflictDoNothing();

describe('cluster mesh resources product scope', () => {
  let user: TestUser;
  let outsider: TestUser;
  let outsiderTenant: string;

  beforeEach(async () => {
    await clearResourceCutover();
    user = await createAuthenticatedUser('editor');
    await grantDefaultTenant(user.id);
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

  it('returns resource_not_found for a forged workspace principal or unresolved tenant', async () => {
    const withPrincipal = (userId: string, workspaceId: string) => new Hono()
      .use('/api/v1/resources/*', async (context, next) => {
        context.set('user', { userId, workspaceId, sessionId: 'forged', role: 'editor' });
        await next();
      })
      .route('/api/v1', createResourcesTransportRouter(productResourcesPorts));
    const forged = await request(withPrincipal(user.id, outsider.workspaceId!), '/resources/list', {
      path: '/',
    });
    const unresolved = await request(withPrincipal(outsider.id, outsider.workspaceId!), '/resources/list', {
      path: '/',
    });
    expect([forged.status, await forged.json()]).toEqual([404, { error: 'resource_not_found' }]);
    expect([unresolved.status, await unresolved.json()]).toEqual([404, { error: 'resource_not_found' }]);
  });
});

const candidate = (enabled = true, control?: ResourcesCutoverControl) => new Hono()
  .route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createResourcesNamespaceModule({ enabled, cutoverControl: control })],
    mounts: { '/resources': '/' },
  }));

describe('cluster mesh resources product author', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearResourceCutover();
    user = await createAuthenticatedUser('editor');
    await grantDefaultTenant(user.id);
  });

  afterEach(async () => {
    await clearResourceCutover();
    await cleanupAuthData();
    await db.delete(workspaces).where(eq(workspaces.id, user.workspaceId!));
  });

  it('selects one direct author and fails closed after the no-HTTP rollback', async () => {
    const app = candidate();
    const path = '/api/v1/resources/list';
    expect((await authenticatedRequest(
      app, 'POST', path, user.sessionToken!, { path: '/' },
    )).status).toBe(200);
    const active = await resourceCutovers.find(resourceKey);
    expect(active).toMatchObject({
      status: 'active',
      activeAuthor: RESOURCES_AUTHOR,
      selectedGenerationId: clusterMeshAdapter.sessionControl!.runtime.generation.generationId,
      previousGenerationId: RESOURCES_PREDECESSOR.previousGenerationId,
      rollbackCheckpoint: { activeAuthor: RESOURCES_PREDECESSOR.rollbackAuthor },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await resourceCutovers.rollback(resourceKey, active!.previousGenerationId!);
    await expect(resourceCutovers.verifyRollback(resourceKey))
      .resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(
      app, 'POST', path, user.sessionToken!, { path: '/' },
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('has no anonymous, disabled, duplicate, or unavailable-control fallback', async () => {
    const path = '/api/v1/resources/list';
    expect((await candidate().request(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"path":"/"}',
    })).status).toBe(401);
    expect((await authenticatedRequest(
      candidate(false), 'POST', path, user.sessionToken!, { path: '/' },
    )).status).toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'POST', '/api/v1/resources/resources/list', user.sessionToken!, { path: '/' },
    )).status).toBe(404);

    const unavailable: ResourcesCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    const blocked = await authenticatedRequest(
      candidate(true, unavailable), 'POST', path, user.sessionToken!, { path: '/' },
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'resources_control_unavailable' });
  });

  it('registers the sole root author and truthfully records no prior HTTP source', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/resources',
    );
    expect(registration?.module.namespace).toBe('/resources');
    expect(registration?.authPaths).toEqual(RESOURCE_PATHS);
    expect('authorPaths' in registration! ? registration.authorPaths : undefined)
      .toEqual(RESOURCE_PATHS);
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/resources']).toBe('/');
    expect(RESOURCES_PREDECESSOR).toMatchObject({
      historicalFixture: 'not_applicable', replayIdempotencyClaim: false,
      rollbackAuthor: 'no-resources-http-author',
    });

    const apiIndex = readFileSync(new URL('../../src/routes/api/index.ts', import.meta.url), 'utf8');
    expect(apiIndex).not.toMatch(/resources|resourceDispatcher|ResourceDispatcher/);
  });
});
