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
import { businessConfig, workspaces } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import { requireAdmin } from '../../src/middleware/rbac';
import type { ConfigCutoverControl } from '../../src/routes/namespaces/config-cutover';
import {
  CONFIG_ADMIN_PATHS,
  CONFIG_AUTHOR,
  CONFIG_PATHS,
  CONFIG_ROUTES,
  createConfigNamespaceModule,
  createConfigTransportRouter,
  type ConfigNamespacePorts,
} from '../../src/routes/namespaces/config-module';
import { productConfigPorts } from '../../src/routes/namespaces/config-product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { businessConfigRouter as legacyBusinessConfigRouter } from '../fixtures/historical/config-f34b609f4/api/src/routes/api/business-config';
import { meRouter as legacyMeRouter } from '../fixtures/historical/config-f34b609f4/api/src/routes/api/me';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/config' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (
  enabled = true,
  ports: ConfigNamespacePorts = productConfigPorts,
  cutoverControl?: ConfigCutoverControl,
) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createConfigNamespaceModule({ enabled, ports, cutoverControl })],
  mounts: { '/config': '/' },
}));
const historicalLegacy = new Hono()
  .use('/api/v1/business-config', requireAuth, requireAdmin)
  .route('/api/v1/business-config', legacyBusinessConfigRouter)
  .use('/api/v1/me', requireAuth)
  .route('/api/v1/me', legacyMeRouter);
const historicalSources = [
  ['business-config.ts', '5a80ba0c6672353b2d26dca24b842977d3d65f8b'],
  ['me.ts', '3fcc96146e7ee58ace12e0f3cd49fccb4ee7fe73'],
] as const;

describe('cluster mesh config cutover', () => {
  let admin: TestUser;
  let candidateOwner: TestUser;
  let historicalOwner: TestUser;

  beforeEach(async () => {
    await clearCutover();
    await db.delete(businessConfig);
    admin = await createAuthenticatedUser('admin_app');
    candidateOwner = await createAuthenticatedUser('editor');
    historicalOwner = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    await db.delete(businessConfig);
    await cleanupAuthData();
    for (const workspaceId of [candidateOwner.workspaceId, historicalOwner.workspaceId]) {
      if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
  });

  it('executes pinned safe-read parity and one durable mutation per isolated twin', async () => {
    for (const [name, expected] of historicalSources) {
      const source = readFileSync(new URL(
        `../fixtures/historical/config-f34b609f4/api/src/routes/api/${name}`,
        import.meta.url,
      ));
      const actual = createHash('sha1')
        .update(`blob ${source.byteLength}\0`).update(source).digest('hex');
      expect(actual).toBe(expected);
    }

    await db.insert(businessConfig).values({
      id: crypto.randomUUID(),
      sectors: JSON.stringify([{ id: 'sector-1', name: 'Seeded sector' }]),
      processes: JSON.stringify([{ id: 'process-1', name: 'Seeded process' }]),
    });
    const path = '/api/v1/business-config';
    const historicalRead = await authenticatedRequest(
      historicalLegacy, 'GET', path, admin.sessionToken!,
    );
    const candidateRead = await authenticatedRequest(candidate(), 'GET', path, admin.sessionToken!);
    expect({ status: candidateRead.status, body: await candidateRead.text() })
      .toEqual({ status: historicalRead.status, body: await historicalRead.text() });

    const candidateName = 'Candidate config twin';
    const historicalName = 'Historical config twin';
    const candidateMutation = await authenticatedRequest(
      candidate(),
      'PATCH',
      '/api/v1/me',
      candidateOwner.sessionToken!,
      { workspaceName: candidateName },
    );
    let twins = await db.select().from(workspaces).where(
      eq(workspaces.id, candidateOwner.workspaceId!),
    );
    expect(twins).toHaveLength(1);
    expect(twins[0]?.name).toBe(candidateName);
    expect((await db.select().from(workspaces).where(
      eq(workspaces.id, historicalOwner.workspaceId!),
    ))[0]?.name).not.toBe(historicalName);

    const historicalMutation = await authenticatedRequest(
      historicalLegacy,
      'PATCH',
      '/api/v1/me',
      historicalOwner.sessionToken!,
      { workspaceName: historicalName },
    );
    twins = await db.select().from(workspaces).where(eq(workspaces.id, historicalOwner.workspaceId!));
    expect(twins).toHaveLength(1);
    expect(twins[0]?.name).toBe(historicalName);
    expect({ status: candidateMutation.status, body: await candidateMutation.text() })
      .toEqual({ status: historicalMutation.status, body: await historicalMutation.text() });
  });

  it('selects one direct author and fails closed after the exact rollback checkpoint', async () => {
    const app = candidate();
    const path = '/api/v1/business-config';
    expect((await authenticatedRequest(app, 'GET', path, admin.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      status: 'active',
      activeAuthor: CONFIG_AUTHOR,
      previousGenerationId: 'legacy-api-config-v1',
      rollbackCheckpoint: { activeAuthor: 'legacy-api-config-routers' },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, admin.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('has no disabled, duplicate-prefix, anonymous, or unavailable-control fallback', async () => {
    const path = '/api/v1/business-config';
    expect((await candidate().request(path)).status).toBe(401);
    expect(await cutovers.find(key)).toBeNull();
    expect((await candidate(false).request(path)).status).toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'GET', '/api/v1/config/business-config', admin.sessionToken!,
    )).status).toBe(404);

    const unavailable: ConfigCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    const blocked = await authenticatedRequest(
      candidate(true, productConfigPorts, unavailable), 'GET', path, admin.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'config_control_unavailable' });
  });

  it('uses exact method fences and an authority-neutral injectable transport', () => {
    const transportPaths = [...new Set(
      createConfigTransportRouter(productConfigPorts).routes
        .filter(({ method }) => method !== 'ALL')
        .map(({ path }) => path),
    )].sort();
    expect(transportPaths).toEqual([...CONFIG_PATHS].sort());
    expect(CONFIG_ADMIN_PATHS).toEqual([
      '/settings', '/business-config', '/ai-settings', '/ai-settings/all', '/ai-settings/:key',
    ]);
    expect(CONFIG_PATHS).not.toContain('/*');

    const routes = createConfigNamespaceModule().createRouter().routes;
    for (const [method, path] of CONFIG_ROUTES) {
      expect(routes).toEqual(expect.arrayContaining([
        expect.objectContaining({ method, path, handler: requireAuth }),
      ]));
      if (path !== '/me') {
        expect(routes).toEqual(expect.arrayContaining([
          expect.objectContaining({ method, path, handler: requireAdmin }),
        ]));
      }
    }
    const source = readFileSync(
      new URL('../../src/routes/namespaces/config.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
    expect(() => createConfigTransportRouter({
      ...productConfigPorts,
      settings: undefined,
    } as unknown as ConfigNamespacePorts)).toThrowError('config product ports are unavailable');
  });

  it('leaves LLM, connector, and client settings outside the config path fence', async () => {
    expect(CONFIG_PATHS).not.toEqual(expect.arrayContaining([
      '/settings/provider-connections',
      '/settings/connector-accounts/max-per-provider',
      '/settings/vscode-extension-token',
    ]));
    const app = candidate();
    for (const path of [
      '/api/v1/settings/provider-connections',
      '/api/v1/settings/connector-accounts/max-per-provider',
      '/api/v1/settings/vscode-extension-token',
    ]) {
      await expect(app.request(path).then(({ status }) => status)).resolves.toBe(404);
    }
  });

  it('registers the real root author and leaves no production legacy config source', async () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/config',
    );
    expect(registration?.module.namespace).toBe('/config');
    expect(registration?.authPaths).toEqual(CONFIG_PATHS);
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/config']).toBe('/');
    expect((await productApp.request('/api/v1/business-config')).status).toBe(401);
    expect((await productApp.request('/api/v1/config/business-config')).status).toBe(404);

    for (const name of ['settings', 'business-config', 'ai-settings', 'me']) {
      expect(existsSync(new URL(`../../src/routes/api/${name}.ts`, import.meta.url))).toBe(false);
    }
    const apiIndex = readFileSync(
      new URL('../../src/routes/api/index.ts', import.meta.url), 'utf8',
    );
    expect(apiIndex).not.toMatch(/settingsRouter|businessConfigRouter|aiSettingsRouter|meRouter/);
    expect(apiIndex).toContain('clientSettingsRouter');
  });
});
