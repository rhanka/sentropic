import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  app as productApp,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
} from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  CATALOG_AUTHOR,
  CATALOG_PATHS,
  CATALOG_PREDECESSOR,
  CATALOG_ROUTES,
  createCatalogNamespaceModule,
  createCatalogTransportRouter,
  type CatalogDiscoveryPort,
  type CatalogNamespacePorts,
} from '../../src/routes/namespaces/catalog-module';
import type { CatalogCutoverControl } from '../../src/routes/namespaces/catalog-cutover';
import { productCatalogDiscovery } from '../../src/routes/namespaces/catalog-product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const pass: MiddlewareHandler = async (_context, next) => next();
const planner = {
  kind: 'skill' as const,
  sourceId: 'foundation',
  metadata: { name: 'planner', description: 'Plan work', category: 'workflow' },
};

const createDiscovery = (): CatalogDiscoveryPort => ({
  list: vi.fn(() => [planner]),
  get: vi.fn((name) => name === planner.metadata.name ? planner : null),
  search: vi.fn(() => [{ entry: planner, score: 5, matchedFields: ['name'] }]),
  sources: vi.fn(() => [{ id: 'foundation', kind: 'static' }]),
});

const createPorts = (catalog = createDiscovery()): CatalogNamespacePorts => ({
  catalog,
  authenticate: pass,
});

describe('cluster mesh catalog transport', () => {
  it('requires injected authority and enumerates exact read-only routes', async () => {
    expect(() => createCatalogTransportRouter({
      ...createPorts(), catalog: undefined,
    } as unknown as CatalogNamespacePorts)).toThrowError('catalog product ports are unavailable');

    const router = createCatalogTransportRouter(createPorts());
    expect(router.routes.map(({ method, path }) => [method, path])).toEqual(CATALOG_ROUTES);
    expect(CATALOG_PATHS).toHaveLength(4);
    expect(CATALOG_PATHS).not.toContain('/*');
    expect(CATALOG_ROUTES.every(([method]) => method === 'GET')).toBe(true);

    const source = readFileSync(
      new URL('../../src/routes/namespaces/catalog.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);

    const app = new Hono().route('/api/v1', router);
    expect((await app.request('/api/v1/catalog/entries/planner', { method: 'POST' })).status)
      .toBe(404);
  });

  it('projects deterministic list, detail, search, and source discovery', async () => {
    const catalog = createDiscovery();
    const app = new Hono().route('/api/v1', createCatalogTransportRouter(createPorts(catalog)));

    const list = await app.request('/api/v1/catalog/entries?kind=skill&sourceId=foundation');
    await expect(list.json()).resolves.toEqual({ items: [planner] });
    expect(catalog.list).toHaveBeenCalledWith({ kind: 'skill', sourceId: 'foundation' });

    const detail = await app.request('/api/v1/catalog/entries/planner');
    await expect(detail.json()).resolves.toEqual({ item: planner });
    const search = await app.request('/api/v1/catalog/search?query=planner&kind=skill&limit=3');
    await expect(search.json()).resolves.toEqual({
      hits: [{ entry: planner, score: 5, matchedFields: ['name'] }],
    });
    expect(catalog.search).toHaveBeenCalledWith({ query: 'planner', kind: 'skill', limit: 3 });
    await expect((await app.request('/api/v1/catalog/sources')).json()).resolves.toEqual({
      items: [{ id: 'foundation', kind: 'static' }],
    });

    expect((await app.request('/api/v1/catalog/search?query=')).status).toBe(400);
    expect((await app.request('/api/v1/catalog/entries/missing')).status).toBe(404);
  });
});

const key = { compositionRoot: 'product' as const, namespace: '/catalog' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const candidate = (enabled = true, control?: CatalogCutoverControl) => new Hono()
  .route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createCatalogNamespaceModule({ enabled, cutoverControl: control })],
    mounts: { '/catalog': '/' },
  }));

const clearCutover = async () => {
  await db.delete(clusterMeshNamespaceCutovers).where(and(
    eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
    eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
  ));
};

describe('cluster mesh catalog product authority', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    await cleanupAuthData();
  });

  it('matches direct canonical deterministic discovery without a predecessor shadow', async () => {
    const directSearch = productCatalogDiscovery.search({
      query: 'workspace', kind: 'skill', limit: 3,
    });
    const directSources = productCatalogDiscovery.sources();
    const search = await authenticatedRequest(
      productApp,
      'GET',
      '/api/v1/catalog/search?query=workspace&kind=skill&limit=3',
      user.sessionToken!,
    );
    const sources = await authenticatedRequest(
      productApp, 'GET', '/api/v1/catalog/sources', user.sessionToken!,
    );
    expect({ status: search.status, body: await search.json() }).toEqual({
      status: 200, body: { hits: JSON.parse(JSON.stringify(directSearch)) },
    });
    await expect(sources.json()).resolves.toEqual({
      items: JSON.parse(JSON.stringify(directSources)),
    });
    expect(CATALOG_PREDECESSOR).toMatchObject({
      historicalFixture: 'not_applicable', replayIdempotencyClaim: false,
    });
  });

  it('selects one direct author and fails closed after the exact no-HTTP rollback', async () => {
    const app = candidate();
    const path = '/api/v1/catalog/entries';
    expect((await authenticatedRequest(app, 'GET', path, user.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      status: 'active',
      activeAuthor: CATALOG_AUTHOR,
      selectedGenerationId: clusterMeshAdapter.sessionControl!.runtime.generation.generationId,
      previousGenerationId: CATALOG_PREDECESSOR.previousGenerationId,
      rollbackCheckpoint: { activeAuthor: CATALOG_PREDECESSOR.rollbackAuthor },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, user.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('has no anonymous, disabled, duplicate, effect, or unavailable-control fallback', async () => {
    const path = '/api/v1/catalog/entries';
    expect((await candidate().request(path)).status).toBe(401);
    expect((await authenticatedRequest(candidate(false), 'GET', path, user.sessionToken!)).status)
      .toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'GET', '/api/v1/catalog/catalog/entries', user.sessionToken!,
    )).status).toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'POST', '/api/v1/catalog/entries/planner/execute', user.sessionToken!, {},
    )).status).toBe(404);

    const unavailable: CatalogCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    const blocked = await authenticatedRequest(
      candidate(true, unavailable), 'GET', path, user.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'catalog_control_unavailable' });
  });

  it('registers the sole root author and confirms the prior HTTP surface is absent', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/catalog',
    );
    expect(registration?.module.namespace).toBe('/catalog');
    expect(registration?.authPaths).toEqual(CATALOG_PATHS);
    expect('authorPaths' in registration! ? registration.authorPaths : undefined)
      .toEqual(CATALOG_PATHS);
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/catalog']).toBe('/');

    const apiIndex = readFileSync(new URL('../../src/routes/api/index.ts', import.meta.url), 'utf8');
    expect(apiIndex).not.toMatch(/catalog|search_catalog/);
    const productPorts = readFileSync(
      new URL('../../src/routes/namespaces/catalog-product-ports.ts', import.meta.url), 'utf8',
    );
    expect(productPorts).not.toMatch(/execution-seam|resource-plane|connector-host|mcp-source/);
  });
});
