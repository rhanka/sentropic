import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createBusinessNamespaceModule,
  createBusinessTransportRouter,
  BUSINESS_PATHS,
  type BusinessNamespacePorts,
} from '../../src/routes/namespaces/business';
import { BUSINESS_AUTHOR } from '../../src/routes/namespaces/business/cutover';
import { productBusinessPorts } from '../../src/routes/namespaces/business/product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/business' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (ports: BusinessNamespacePorts = productBusinessPorts, enabled = true) =>
  new Hono().route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createBusinessNamespaceModule({ enabled, ports })],
    mounts: { '/business': '/' },
  }));

describe('cluster mesh business pre-deletion shadow', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    await cleanupAuthData();
  });

  it('matches a safe legacy read and dispatches one validated mutation intent', async () => {
    const path = '/api/v1/organizations';
    const legacy = await authenticatedRequest(productApp, 'GET', path, user.sessionToken!);
    const shadow = await authenticatedRequest(candidate(), 'GET', path, user.sessionToken!);
    const legacyBody = await legacy.text();
    expect(shadow.status).toBe(legacy.status);
    expect(await shadow.text()).toBe(legacyBody);

    const createIntent = vi.fn();
    const organizations = new Hono().post('/', (context) => {
      createIntent();
      return context.json({ id: 'candidate-only' }, 201);
    });
    const ports = {
      ...productBusinessPorts,
      organizations: { createRouter: () => organizations },
    };
    const intent = await authenticatedRequest(
      candidate(ports), 'POST', path, user.sessionToken!, { name: 'Validated intent' },
    );
    expect(intent.status).toBe(201);
    expect(createIntent).toHaveBeenCalledTimes(1);

    const unchanged = await authenticatedRequest(productApp, 'GET', path, user.sessionToken!);
    expect(await unchanged.text()).toBe(legacyBody);
  });

  it('enumerates every preserved business path without a transport catch-all', () => {
    const paths = [...new Set(
      createBusinessTransportRouter(productBusinessPorts).routes
        .filter(({ method }) => method !== 'ALL')
        .map(({ path }) => path),
    )].sort();
    expect(paths).toEqual([...BUSINESS_PATHS].sort());
    expect(paths).not.toContain('/*');
  });

  it('selects one author and fails closed after the exact rollback checkpoint', async () => {
    const app = candidate();
    const path = '/api/v1/organizations';
    expect((await authenticatedRequest(app, 'GET', path, user.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      activeAuthor: BUSINESS_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-business-v1',
      rollbackCheckpoint: { activeAuthor: 'legacy-api-business-routers' },
      shadowComparison: { effectsDuplicated: false },
    });
    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, user.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('preserves the use-case alias and distinct bid and proposal authorities', async () => {
    const initiatives = new Hono().get('/', (context) => context.json({ kind: 'initiative' }));
    const bids = new Hono().get('/', (context) => context.json({ kind: 'bid' }));
    const proposals = new Hono().get('/', (context) => context.json({ kind: 'proposal' }));
    const app = candidate({
      ...productBusinessPorts,
      initiatives: { createRouter: () => initiatives },
      bids: { createRouter: () => bids },
      proposals: { createRouter: () => proposals },
    });

    for (const [path, kind] of [
      ['/api/v1/initiatives', 'initiative'],
      ['/api/v1/use-cases', 'initiative'],
      ['/api/v1/bids', 'bid'],
      ['/api/v1/proposals', 'proposal'],
    ] as const) {
      const response = await authenticatedRequest(app, 'GET', path, user.sessionToken!);
      await expect(response.json()).resolves.toEqual({ kind });
    }
  });

  it('authenticates exact paths and disables without fallback or duplicate prefix', async () => {
    const path = '/api/v1/organizations';
    expect((await candidate().request(path)).status).toBe(401);
    expect(await cutovers.find(key)).toBeNull();
    expect((await candidate(productBusinessPorts, false).request(path)).status).toBe(404);
    expect(await cutovers.find(key)).toBeNull();

    const app = candidate();
    expect((await authenticatedRequest(app, 'GET', path, user.sessionToken!)).status).toBe(200);
    expect((await authenticatedRequest(
      app, 'GET', '/api/v1/business/organizations', user.sessionToken!,
    )).status).toBe(404);
  });
});
