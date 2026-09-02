import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import { folders, initiatives, workspaces } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import {
  ANALYTICS_PATHS,
  createAnalyticsTransportRouter,
} from '../../src/routes/namespaces/analytics';
import { productAnalyticsPorts } from '../../src/routes/namespaces/analytics/product-ports';
import { analyticsRouter as legacyAnalyticsRouter } from '../fixtures/historical/analytics-f0a7e47eb/api/src/routes/api/analytics';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const candidateTransport = () => {
  const router = new Hono();
  for (const path of ANALYTICS_PATHS) router.use(path, requireAuth);
  router.route('/', createAnalyticsTransportRouter(productAnalyticsPorts));
  return new Hono().route('/api/v1', router);
};

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
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (user.workspaceId) {
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
      const candidate = await authenticatedRequest(candidateTransport(), 'GET', path, user.sessionToken!);
      expect({ status: candidate.status, body: await candidate.text() })
        .toEqual({ status: legacy.status, body: await legacy.text() });
    }
  });
});
