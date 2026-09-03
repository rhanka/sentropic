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
import { users } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import { requireAdmin, requireRole } from '../../src/middleware/rbac';
import type { AdminCutoverControl } from '../../src/routes/namespaces/admin-cutover';
import {
  ADMIN_APP_PATHS,
  ADMIN_AUTHOR,
  ADMIN_PATHS,
  ADMIN_ROUTES,
  ADMIN_TENANT_METRICS_PATHS,
  createAdminNamespaceModule,
  createAdminTransportRouter,
  type AdminNamespacePorts,
} from '../../src/routes/namespaces/admin-module';
import { productAdminPorts } from '../../src/routes/namespaces/admin-product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  recordTenantResolution,
  resetTenantResolutionMetrics,
} from '../../src/services/tenancy/tenant-resolution-metrics';
import {
  adminRouter as historicalAdminRouter,
  tenantResolutionMetricsRouter as historicalTenantMetricsRouter,
} from '../fixtures/historical/admin-e338673c1/api/src/routes/api/admin';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const historicalAdminApp = requireRole('admin_app');
const historical = new Hono()
  .on('GET', '/api/v1/admin/tenant-resolution-metrics', requireAuth, requireAdmin)
  .route('/api/v1/admin/tenant-resolution-metrics', historicalTenantMetricsRouter)
  .on('POST', '/api/v1/admin/reset', requireAuth, historicalAdminApp)
  .on('GET', '/api/v1/admin/stats', requireAuth, historicalAdminApp)
  .on('GET', '/api/v1/admin/users', requireAuth, historicalAdminApp)
  .on('POST', '/api/v1/admin/users/:id/approve', requireAuth, historicalAdminApp)
  .on('POST', '/api/v1/admin/users/:id/disable', requireAuth, historicalAdminApp)
  .on('POST', '/api/v1/admin/users/:id/reactivate', requireAuth, historicalAdminApp)
  .on('DELETE', '/api/v1/admin/users/:id', requireAuth, historicalAdminApp)
  .route('/api/v1/admin', historicalAdminRouter);

const key = { compositionRoot: 'product' as const, namespace: '/admin' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (
  enabled = true,
  ports: AdminNamespacePorts = productAdminPorts,
  cutoverControl?: AdminCutoverControl,
) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createAdminNamespaceModule({ enabled, ports, cutoverControl })],
  mounts: { '/admin': '/' },
}));

const fixtureRoot = '../fixtures/historical/admin-e338673c1/api/src';
const bridgeDigests = [
  ['db/client.ts', 'a26b33f68913593f17d07f288b855d14e0f21e537592673a42d5ae28606a5b99'],
  ['db/schema.ts', '8889df5d01f5c72912771f78495164ea81b7dfd456c36b12de74c796de2e36d0'],
  [
    'services/connector-grant-teardown.ts',
    '6f8277ded1e3f479ad5943f43a9bc3aefc3214a3a5fc6229c2956bfdd8c71730',
  ],
  [
    'services/tenancy/tenant-resolution-metrics.ts',
    'b04c3c9603f23b989555619aebee3fdeb5a8f41fdb6020e547f959ffff7a1b3a',
  ],
] as const;

describe('cluster mesh admin cutover', () => {
  let appAdmin: TestUser;
  let tenantAdmin: TestUser;

  beforeEach(async () => {
    await clearCutover();
    resetTenantResolutionMetrics();
    appAdmin = await createAuthenticatedUser('admin_app');
    tenantAdmin = await createAuthenticatedUser('admin_org');
  });

  afterEach(async () => {
    await clearCutover();
    resetTenantResolutionMetrics();
    await cleanupAuthData();
    vi.restoreAllMocks();
  });

  it('pins the executable predecessor source and unchanged authority bridges', () => {
    const source = readFileSync(new URL(`${fixtureRoot}/routes/api/admin.ts`, import.meta.url));
    expect(createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex'))
      .toBe('71ec3755c976b796fc12ffaaa7f6009ba1b24971');
    for (const [path, digest] of bridgeDigests) {
      const bridge = readFileSync(new URL(`${fixtureRoot}/${path}`, import.meta.url));
      expect(createHash('sha256').update(bridge).digest('hex'), path).toBe(digest);
    }
    expect(historical.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/api/v1/admin/stats' }),
      expect.objectContaining({
        method: 'GET', path: '/api/v1/admin/tenant-resolution-metrics', handler: requireAdmin,
      }),
    ]));
  });

  it('constructs only with every explicit product authority port', () => {
    expect(() => createAdminTransportRouter({
      ...productAdminPorts,
      tenantMetrics: undefined,
    } as unknown as AdminNamespacePorts)).toThrowError('admin product ports are unavailable');
    expect(createAdminTransportRouter(productAdminPorts).routes.length).toBeGreaterThan(0);
  });

  it('executes seeded authenticated admin and tenant safe reads over authoritative state', async () => {
    const pending = await createAuthenticatedUser('editor');
    await db.update(users).set({
      accountStatus: 'pending_admin_approval',
      approvalDueAt: new Date('2026-09-04T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    }).where(eq(users.id, pending.id));
    recordTenantResolution('d11-admin-safe-read');

    const reads = [
      {
        path: '/api/v1/admin/users?status=pending_admin_approval',
        token: appAdmin.sessionToken!,
      },
      {
        path: '/api/v1/admin/tenant-resolution-metrics',
        token: tenantAdmin.sessionToken!,
      },
    ];
    for (const { path, token } of reads) {
      const invoke = (app: Hono) => authenticatedRequest(app, 'GET', path, token);
      const legacy = await invoke(historical);
      const active = await invoke(candidate());
      expect({ status: active.status, body: await active.text() }, path)
        .toEqual({ status: legacy.status, body: await legacy.text() });
    }
  });

  it('performs isolated authoritative candidate and historical approval mutations', async () => {
    const candidateTarget = await createAuthenticatedUser('editor');
    const historicalTarget = await createAuthenticatedUser('editor');
    const pendingState = {
      accountStatus: 'pending_admin_approval' as const,
      approvalDueAt: new Date('2026-09-04T00:00:00.000Z'),
      approvedAt: null,
      approvedByUserId: null,
    };
    await db.update(users).set(pendingState).where(eq(users.id, candidateTarget.id));
    await db.update(users).set(pendingState).where(eq(users.id, historicalTarget.id));
    const approve = (app: Hono, userId: string) => authenticatedRequest(
      app,
      'POST',
      `/api/v1/admin/users/${userId}/approve`,
      appAdmin.sessionToken!,
      { role: 'guest' },
    );

    const active = await approve(candidate(), candidateTarget.id);
    expect({ status: active.status, body: await active.json() })
      .toEqual({ status: 200, body: { success: true } });
    const [candidateRow] = await db.select().from(users)
      .where(eq(users.id, candidateTarget.id)).limit(1);
    const [untouchedHistoricalRow] = await db.select().from(users)
      .where(eq(users.id, historicalTarget.id)).limit(1);
    expect(candidateRow).toMatchObject({
      role: 'guest', accountStatus: 'active', approvedByUserId: appAdmin.id,
    });
    expect(candidateRow.approvedAt).toBeInstanceOf(Date);
    expect(untouchedHistoricalRow).toMatchObject({
      role: 'editor', accountStatus: 'pending_admin_approval', approvedByUserId: null,
    });

    const legacy = await approve(historical, historicalTarget.id);
    expect({ status: legacy.status, body: await legacy.json() })
      .toEqual({ status: 200, body: { success: true } });
    const [historicalRow] = await db.select().from(users)
      .where(eq(users.id, historicalTarget.id)).limit(1);
    expect(historicalRow).toMatchObject({
      role: 'guest', accountStatus: 'active', approvedByUserId: appAdmin.id,
    });
    expect(historicalRow.approvedAt).toBeInstanceOf(Date);
  });

  it('selects one direct author and fails closed after the exact rollback checkpoint', async () => {
    const app = candidate();
    const path = '/api/v1/admin/users';
    expect((await authenticatedRequest(app, 'GET', path, appAdmin.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      status: 'active',
      activeAuthor: ADMIN_AUTHOR,
      selectedGenerationId: clusterMeshAdapter.sessionControl!.runtime.generation.generationId,
      previousGenerationId: 'legacy-api-admin-v1',
      rollbackCheckpoint: { activeAuthor: 'legacy-api-admin-router' },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, appAdmin.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('has no disabled, duplicate, role, or unavailable-control fallback', async () => {
    const path = '/api/v1/admin/users';
    expect((await candidate().request(path)).status).toBe(401);
    expect(await cutovers.find(key)).toBeNull();
    expect((await candidate(false).request(path)).status).toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'GET', '/api/v1/admin/admin/users', appAdmin.sessionToken!,
    )).status).toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'GET', path, tenantAdmin.sessionToken!,
    )).status).toBe(403);

    const unavailable: AdminCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    const blocked = await authenticatedRequest(
      candidate(true, productAdminPorts, unavailable),
      'GET',
      path,
      appAdmin.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'admin_control_unavailable' });
  });

  it('enumerates the exact transport methods and paths without a wildcard', () => {
    const transportPaths = [...new Set(
      createAdminTransportRouter(productAdminPorts).routes
        .filter(({ method }) => method !== 'ALL')
        .map(({ path }) => path),
    )].sort();
    expect(transportPaths).toEqual([...ADMIN_PATHS].sort());
    expect(ADMIN_PATHS).toHaveLength(8);
    expect(ADMIN_PATHS).not.toContain('/*');
    expect(ADMIN_ROUTES).toHaveLength(8);
  });

  it('registers one root author and leaves no legacy mount or production source', async () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/admin',
    );
    expect(registration?.module.namespace).toBe('/admin');
    expect(registration?.authPaths).toEqual(ADMIN_PATHS);
    expect('authorPaths' in registration! ? registration.authorPaths : undefined)
      .toEqual(ADMIN_PATHS);
    expect(registration?.privilegedFences).toEqual([
      expect.objectContaining({ name: 'app-admin', paths: ADMIN_APP_PATHS }),
      expect.objectContaining({ name: 'admin', paths: ADMIN_TENANT_METRICS_PATHS }),
    ]);
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/admin']).toBe('/');
    expect((await productApp.request('/api/v1/admin/users')).status).toBe(401);
    expect((await authenticatedRequest(
      productApp, 'GET', '/api/v1/admin/admin/users', appAdmin.sessionToken!,
    )).status).toBe(404);

    expect(existsSync(new URL('../../src/routes/api/admin.ts', import.meta.url))).toBe(false);
    const apiIndex = readFileSync(new URL('../../src/routes/api/index.ts', import.meta.url), 'utf8');
    expect(apiIndex).not.toMatch(/adminRouter|tenantResolutionMetricsRouter|\/admin/);
    const transport = readFileSync(
      new URL('../../src/routes/namespaces/admin.ts', import.meta.url), 'utf8',
    );
    expect(transport).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
    const productPorts = readFileSync(
      new URL('../../src/routes/namespaces/admin-product-ports.ts', import.meta.url), 'utf8',
    );
    expect(productPorts).not.toContain('fixtures/historical');
  });
});
