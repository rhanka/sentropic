import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { folders, initiatives, solutions, workspaces } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
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
import { solutionsRouter as legacySolutionsRouter } from '../fixtures/historical/business-36a93f2b0/api/src/routes/api/solutions';
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
const historicalLegacy = new Hono()
  .use('/api/v1/solutions', requireAuth)
  .use('/api/v1/solutions/*', requireAuth)
  .route('/api/v1/solutions', legacySolutionsRouter);
const historicalSourceUrl = new URL(
  '../fixtures/historical/business-36a93f2b0/api/src/routes/api/solutions.ts',
  import.meta.url,
);

describe('cluster mesh business cutover', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    if (user.workspaceId) {
      await db.delete(solutions).where(eq(solutions.workspaceId, user.workspaceId));
      await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
      await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
    if (user.workspaceId) await db.delete(workspaces).where(eq(workspaces.id, user.workspaceId));
  });

  it('runs pinned legacy reads and one-effect DELETE parity on authoritative state', async () => {
    const source = readFileSync(historicalSourceUrl);
    const blobHash = createHash('sha1')
      .update(`blob ${source.byteLength}\0`).update(source).digest('hex');
    expect(blobHash).toBe('2a2357a24778eadc7724572321e67620b5c8aca3');

    const folderId = crypto.randomUUID();
    const initiativeId = crypto.randomUUID();
    const candidateSolutionId = crypto.randomUUID();
    const legacySolutionId = crypto.randomUUID();
    await db.insert(folders).values({
      id: folderId, workspaceId: user.workspaceId!, name: 'D11 parity', status: 'completed',
    });
    await db.insert(initiatives).values({
      id: initiativeId, workspaceId: user.workspaceId!, folderId, data: { name: 'D11 parity' },
    });
    await db.insert(solutions).values([
      { id: candidateSolutionId, workspaceId: user.workspaceId!, initiativeId, data: { kind: 'parity' } },
      { id: legacySolutionId, workspaceId: user.workspaceId!, initiativeId, data: { kind: 'parity' } },
    ]);

    for (const path of [
      `/api/v1/solutions?initiative_id=${initiativeId}`,
      `/api/v1/solutions/${candidateSolutionId}`,
    ]) {
      const legacy = await authenticatedRequest(historicalLegacy, 'GET', path, user.sessionToken!);
      const current = await authenticatedRequest(candidate(), 'GET', path, user.sessionToken!);
      expect({ status: current.status, body: await current.text() })
        .toEqual({ status: legacy.status, body: await legacy.text() });
    }

    const before = await db.select().from(solutions).where(eq(solutions.initiativeId, initiativeId));
    const currentDelete = await authenticatedRequest(
      candidate(), 'DELETE', `/api/v1/solutions/${candidateSolutionId}`, user.sessionToken!,
    );
    const afterCurrent = await db.select().from(solutions).where(eq(solutions.initiativeId, initiativeId));
    expect(before.length - afterCurrent.length).toBe(1);
    expect(afterCurrent.map(({ id }) => id)).toEqual([legacySolutionId]);

    const legacyDelete = await authenticatedRequest(
      historicalLegacy, 'DELETE', `/api/v1/solutions/${legacySolutionId}`, user.sessionToken!,
    );
    const afterLegacy = await db.select().from(solutions).where(eq(solutions.initiativeId, initiativeId));
    expect(afterCurrent.length - afterLegacy.length).toBe(1);
    expect(afterLegacy).toHaveLength(0);
    expect({ status: currentDelete.status, body: await currentDelete.text() })
      .toEqual({ status: legacyDelete.status, body: await legacyDelete.text() });
  });

  it('keeps the injected spy as dispatch-unit coverage rather than D11 proof', async () => {
    const path = '/api/v1/organizations';
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

  it('leaves the authenticated legacy DOCX tombstone with the documents owner', async () => {
    const path = '/api/v1/use-cases/legacy-id/docx';
    expect((await candidate().request(path)).status).toBe(404);
    expect((await productApp.request(path)).status).toBe(401);
    expect((await authenticatedRequest(
      productApp, 'GET', path, user.sessionToken!,
    )).status).toBe(410);
    expect(BUSINESS_PATHS).not.toContain('/use-cases/:id/docx');
  });

  it('fails composition when an injected product dependency is unavailable', () => {
    expect(() => createBusinessTransportRouter({
      ...productBusinessPorts,
      organizations: {
        createRouter() {
          throw new Error('organizations unavailable');
        },
      },
    })).toThrowError('organizations unavailable');
  });

  it('keeps every business transport module free of product authority imports', () => {
    const transportModules = [
      'ports',
      'organizations',
      'folders',
      'initiatives',
      'solutions',
      'products',
      'proposals',
      'bids',
      'view-templates',
      'router',
    ];
    const sources = transportModules.map((name) => readFileSync(
      new URL(`../../src/routes/namespaces/business/${name}.ts`, import.meta.url),
      'utf8',
    ));
    for (const source of sources) {
      expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
    }
  });
});
