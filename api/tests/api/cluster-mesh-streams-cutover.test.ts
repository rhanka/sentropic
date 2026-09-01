import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app as legacyApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createStreamsNamespaceModule,
  STREAM_PATHS,
} from '../../src/routes/namespaces/streams';
import { STREAMS_AUTHOR } from '../../src/routes/namespaces/streams-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const cutovers = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/streams' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/streams'),
));
const candidate = (enabled = true) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createStreamsNamespaceModule({ enabled })],
  mounts: { '/streams': '/' },
}));

describe('cluster mesh streams cutover', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    await cleanupAuthData();
  });

  it('shadows active envelopes and validates a read-only route intent', async () => {
    const path = '/api/v1/streams/active?since_minutes=360&limit=200';
    const legacy = await authenticatedRequest(legacyApp, 'GET', path, user.sessionToken!);
    const shadow = await authenticatedRequest(candidate(), 'GET', path, user.sessionToken!);
    expect(shadow.status).toBe(legacy.status);
    expect(await shadow.text()).toBe(await legacy.text());

    const effectRoutes = createStreamsNamespaceModule().createRouter().routes
      .filter(({ method }) => method !== 'ALL')
      .map(({ method, path: routePath }) => `${method} ${routePath}`);
    expect(effectRoutes).toEqual(STREAM_PATHS.map((routePath) => `GET ${routePath}`));
  });

  it('selects one transport author and fails closed after verified rollback', async () => {
    const app = candidate();
    const path = '/api/v1/streams/active';
    expect((await authenticatedRequest(app, 'GET', path, user.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      activeAuthor: STREAMS_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-streams-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, user.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('authenticates exact paths and disables without selecting a fallback', async () => {
    expect((await candidate().request('/api/v1/streams/active')).status).toBe(401);
    expect(await cutovers.find(key)).toBeNull();
    expect((await candidate(false).request('/api/v1/streams/active')).status).toBe(404);
    expect(await cutovers.find(key)).toBeNull();
  });
});
