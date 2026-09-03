import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  app as productApp,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
} from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { settings } from '../../src/db/schema';
import type { HealthCutoverControl } from '../../src/routes/namespaces/health';
import {
  HEALTH_AUTHOR,
  HEALTH_PATHS,
  HEALTH_ROUTES,
  createProductHealthNamespaceModule,
} from '../../src/routes/namespaces/health';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { healthRouter as historicalHealthRouter } from '../fixtures/historical/health-6704c85cf/api/src/routes/api/health';

const key = { compositionRoot: 'product' as const, namespace: '/health' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const state = {
  snapshot: () => ({
    generation: clusterMeshAdapter.sessionControl!.runtime.generation,
    modules: [{ namespace: '/health' as const, enabled: true }],
  }),
};
const candidate = (enabled = true, control?: HealthCutoverControl) => new Hono()
  .route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createProductHealthNamespaceModule({ state, enabled, cutoverControl: control })],
    mounts: { '/health': '/' },
  }));
const historical = new Hono().route('/api/v1/health', historicalHealthRouter);
const fixtureRoot = '../fixtures/historical/health-6704c85cf/api/src';
const seedKey = 'cluster-mesh-health-d11-seed';

describe('cluster mesh health cutover', () => {
  beforeEach(async () => {
    await clearCutover();
    await db.delete(settings).where(eq(settings.key, seedKey));
    await db.insert(settings).values({ key: seedKey, value: 'present' });
  });

  afterEach(async () => {
    await clearCutover();
    await db.delete(settings).where(eq(settings.key, seedKey));
    vi.restoreAllMocks();
  });

  it('pins the executable predecessor and unchanged authority bridges', () => {
    const source = readFileSync(new URL(`${fixtureRoot}/routes/api/health.ts`, import.meta.url));
    expect(createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex'))
      .toBe('da9555bfee8779582495eff46d252f53c66708b2');
    const bridges = [
      ['db/client.ts', 'a26b33f68913593f17d07f288b855d14e0f21e537592673a42d5ae28606a5b99'],
      ['db/schema.ts', '16e0d13007c98955257240014941e5aa8859b5bf255c5fc28a712c2526bd91e8'],
    ] as const;
    for (const [path, digest] of bridges) {
      expect(createHash('sha256').update(readFileSync(
        new URL(`${fixtureRoot}/${path}`, import.meta.url),
      )).digest('hex'), path).toBe(digest);
    }
  });

  it('shadows the seeded legacy safe-read projection without a domain write', async () => {
    const legacy = await historical.request('/api/v1/health');
    const active = await candidate().request('/api/v1/health');
    const legacyBody = await legacy.json();
    const activeBody = await active.json();

    expect({ status: active.status, body: { status: activeBody.status, services: activeBody.services } })
      .toEqual({ status: legacy.status, body: { status: legacyBody.status, services: legacyBody.services } });
    expect(activeBody).toMatchObject({
      clusterMesh: state.snapshot(), readiness: { status: 'ready', reasons: [] },
    });
    await expect(db.select().from(settings).where(eq(settings.key, seedKey)))
      .resolves.toHaveLength(1);
  });

  it('selects one direct author and fails closed after exact rollback', async () => {
    const app = candidate();
    expect((await app.request('/api/v1/health')).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      status: 'active', activeAuthor: HEALTH_AUTHOR,
      selectedGenerationId: clusterMeshAdapter.sessionControl!.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-health-v1',
      rollbackCheckpoint: { activeAuthor: 'legacy-api-health-router' },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await app.request('/api/v1/health');
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('has no disabled, duplicate, unavailable-control, or legacy fallback', async () => {
    const unavailable: HealthCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    expect((await candidate(false).request('/api/v1/health')).status).toBe(404);
    expect((await productApp.request('/api/v1/health/health')).status).toBe(404);
    const blocked = await candidate(true, unavailable).request('/api/v1/health');
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'health_control_unavailable' });

    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/health',
    );
    expect(registration).toMatchObject({ authPaths: HEALTH_PATHS, authorPaths: HEALTH_PATHS });
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/health']).toBe('/');
    expect(HEALTH_ROUTES).toEqual([['GET', '/health']]);
    expect(HEALTH_PATHS).not.toContain('/*');
    expect(existsSync(new URL('../../src/routes/api/health.ts', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../../src/routes/api/index.ts', import.meta.url))).toBe(false);
    const transport = readFileSync(
      new URL('../../../packages/cluster-mesh/src/hono/health-router.ts', import.meta.url), 'utf8',
    );
    expect(transport).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
  });
});
