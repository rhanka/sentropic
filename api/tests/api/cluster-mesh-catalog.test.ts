import { readFileSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  CATALOG_PATHS,
  CATALOG_ROUTES,
  createCatalogTransportRouter,
  type CatalogDiscoveryPort,
  type CatalogNamespacePorts,
} from '../../src/routes/namespaces/catalog-module';

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
