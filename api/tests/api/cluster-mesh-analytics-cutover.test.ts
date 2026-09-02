import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { folders, initiatives, jobQueue, workspaces } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import {
  createAnalyticsNamespaceModule,
} from '../../src/routes/namespaces/analytics';
import { productAnalyticsPorts } from '../../src/routes/namespaces/analytics/product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { analyticsRouter as legacyAnalyticsRouter } from '../fixtures/historical/analytics-f0a7e47eb/api/src/routes/api/analytics';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/analytics' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = () => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createAnalyticsNamespaceModule({ ports: productAnalyticsPorts })],
  mounts: { '/analytics': '/' },
}));

const historicalLegacy = new Hono()
  .use('/api/v1/analytics/*', requireAuth)
  .route('/api/v1/analytics', legacyAnalyticsRouter);

const historicalSourceUrl = new URL(
  '../fixtures/historical/analytics-f0a7e47eb/api/src/routes/api/analytics.ts',
  import.meta.url,
);

describe('cluster mesh analytics cutover', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    if (user.workspaceId) {
      await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
      await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
      await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
    if (user.workspaceId) await db.delete(workspaces).where(eq(workspaces.id, user.workspaceId));
  });

  it('executes the pinned legacy router with byte-identical authenticated reads', async () => {
    const source = readFileSync(historicalSourceUrl);
    const blobHash = createHash('sha1')
      .update(`blob ${source.byteLength}\0`)
      .update(source)
      .digest('hex');
    expect(blobHash).toBe('10f7d7762a550343a51be08a37d812bc5b1c91ae');

    const folderId = crypto.randomUUID();
    await db.insert(folders).values({
      id: folderId,
      workspaceId: user.workspaceId!,
      name: 'Analytics D11 read parity',
      status: 'completed',
      matrixConfig: JSON.stringify({
        valueAxes: [{ id: 'value', name: 'Value', weight: 1 }],
        complexityAxes: [{ id: 'complexity', name: 'Complexity', weight: 1 }],
      }),
    });
    await db.insert(initiatives).values({
      id: crypto.randomUUID(),
      workspaceId: user.workspaceId!,
      folderId,
      data: {
        name: 'Pinned analytics item',
        process: 'Characterization',
        valueScores: [{ axisId: 'value', rating: 8 }],
        complexityScores: [{ axisId: 'complexity', rating: 3 }],
      },
    });

    for (const path of [
      `/api/v1/analytics/summary?folder_id=${folderId}`,
      `/api/v1/analytics/scatter?folder_id=${folderId}`,
    ]) {
      const legacy = await authenticatedRequest(historicalLegacy, 'GET', path, user.sessionToken!);
      const current = await authenticatedRequest(candidate(), 'GET', path, user.sessionToken!);
      expect({ status: current.status, body: await current.text() })
        .toEqual({ status: legacy.status, body: await legacy.text() });
    }
  });

  it('creates exactly one durable job per isolated candidate and historical twin', async () => {
    const candidateFolderId = crypto.randomUUID();
    const legacyFolderId = crypto.randomUUID();
    await db.insert(folders).values([
      {
        id: candidateFolderId,
        workspaceId: user.workspaceId!,
        name: 'Candidate mutation twin',
        status: 'completed',
      },
      {
        id: legacyFolderId,
        workspaceId: user.workspaceId!,
        name: 'Historical mutation twin',
        status: 'completed',
      },
    ]);
    const readJobs = () => db.select().from(jobQueue).where(and(
      eq(jobQueue.workspaceId, user.workspaceId!),
      eq(jobQueue.type, 'executive_summary'),
    ));

    const before = await readJobs();
    expect(before).toHaveLength(0);
    const currentResponse = await authenticatedRequest(
      candidate(),
      'POST',
      '/api/v1/analytics/executive-summary',
      user.sessionToken!,
      { folder_id: candidateFolderId, value_threshold: 55, complexity_threshold: 34 },
      { 'x-app-locale': 'en' },
    );
    const afterCandidate = await readJobs();
    expect(afterCandidate.length - before.length).toBe(1);
    const [candidateState, untouchedTwin] = await Promise.all([
      db.select().from(folders).where(eq(folders.id, candidateFolderId)),
      db.select().from(folders).where(eq(folders.id, legacyFolderId)),
    ]);
    expect(candidateState[0]?.status).toBe('generating');
    expect(untouchedTwin[0]?.status).toBe('completed');

    const legacyResponse = await authenticatedRequest(
      historicalLegacy,
      'POST',
      '/api/v1/analytics/executive-summary',
      user.sessionToken!,
      { folder_id: legacyFolderId, value_threshold: 55, complexity_threshold: 34 },
      { 'x-app-locale': 'en' },
    );
    const afterLegacy = await readJobs();
    expect(afterLegacy.length - afterCandidate.length).toBe(1);
    expect(afterLegacy).toHaveLength(2);
    expect((await db.select().from(folders).where(eq(folders.id, legacyFolderId)))[0]?.status)
      .toBe('generating');

    const candidateJob = afterLegacy.find(({ id }) => id === afterCandidate[0]!.id)!;
    const legacyJob = afterLegacy.find(({ id }) => id !== candidateJob.id)!;
    const normalizeJob = (data: string) => ({ ...JSON.parse(data), folderId: '<twin>' });
    expect(normalizeJob(candidateJob.data)).toEqual(normalizeJob(legacyJob.data));
    const normalizeResponse = async (response: Response) => ({
      status: response.status,
      body: { ...await response.json(), folder_id: '<twin>', jobId: '<job>' },
    });
    expect(await normalizeResponse(currentResponse)).toEqual(await normalizeResponse(legacyResponse));
  });
});
