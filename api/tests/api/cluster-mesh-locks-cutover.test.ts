import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { requireAuth } from '../../src/middleware/auth';
import {
  createLocksTransportRouter,
  createLocksNamespaceModule,
  LOCK_PATHS,
} from '../../src/routes/namespaces/locks';
import { LOCKS_AUTHOR } from '../../src/routes/namespaces/locks-cutover';
import type { LocksNamespacePorts } from '../../src/routes/namespaces/locks-ports';
import { productLocksPorts } from '../../src/routes/namespaces/locks-product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const candidate = (ports: LocksNamespacePorts) => {
  const api = new Hono();
  for (const path of LOCK_PATHS) api.use(path, requireAuth);
  api.route('/', createLocksTransportRouter(ports));
  return new Hono().route('/api/v1', api);
};

const fakePorts = (): LocksNamespacePorts => ({
  locks: {
    read: vi.fn(async () => null),
    acquire: vi.fn(async () => ({ lock: { id: 'lock-candidate' }, acquired: true })),
    release: vi.fn(async () => ({ released: true })),
    requestUnlock: vi.fn(async () => ({ requested: true, lock: null })),
    acceptUnlock: vi.fn(async () => ({ accepted: true, lock: null })),
    forceUnlock: vi.fn(async () => ({ forced: true })),
  },
  presence: {
    list: vi.fn(async () => ({ users: [], total: 0 })),
    record: vi.fn(async () => ({ users: [], total: 0 })),
    remove: vi.fn(async () => ({ users: [], total: 0 })),
  },
  authorization: { permits: vi.fn(async () => true) },
  stream: {
    clearForUser: vi.fn(async () => undefined),
    readLock: vi.fn(async () => null),
    readPresence: vi.fn(async () => ({ users: [], total: 0 })),
  },
});

const cutovers = new PostgresClusterMeshCutoverStore();
const cutoverKey = { compositionRoot: 'product' as const, namespace: '/locks' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/locks'),
));
const mounted = (enabled = true, ports: LocksNamespacePorts = productLocksPorts) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createLocksNamespaceModule({ enabled, ports })],
  mounts: { '/locks': '/' },
}));

describe('cluster mesh locks pre-deletion shadow', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    await cleanupAuthData();
  });

  it('matches the legacy safe read and dispatches validated mutation intent once', async () => {
    const query = `workspace_id=${user.workspaceId}&objectType=organization&objectId=shadow-object`;
    const legacy = await authenticatedRequest(
      productApp, 'GET', `/api/v1/locks?${query}`, user.sessionToken!,
    );
    const shadow = await authenticatedRequest(
      candidate(productLocksPorts), 'GET', `/api/v1/locks?${query}`, user.sessionToken!,
    );
    expect(shadow.status).toBe(legacy.status);
    expect(await shadow.text()).toBe(await legacy.text());

    const ports = fakePorts();
    const intent = await authenticatedRequest(
      candidate(ports),
      'POST',
      `/api/v1/locks?workspace_id=${user.workspaceId}`,
      user.sessionToken!,
      { objectType: 'organization', objectId: 'validated-intent' },
    );
    expect(intent.status).toBe(201);
    expect(ports.locks.acquire).toHaveBeenCalledTimes(1);
    await expect(productLocksPorts.locks.read({
      workspaceId: user.workspaceId!,
      objectType: 'organization',
      objectId: 'validated-intent',
    })).resolves.toBeNull();
  });

  it('enumerates the preserved method and path fence without an effect catch-all', () => {
    const routes = [...new Set(
      createLocksTransportRouter(fakePorts()).routes
        .filter(({ method }) => method !== 'ALL')
        .map(({ method, path }) => `${method} ${path}`),
    )];
    expect(routes).toEqual([
      'GET /locks',
      'POST /locks',
      'DELETE /locks',
      'POST /locks/request-unlock',
      'POST /locks/accept-unlock',
      'POST /locks/force-unlock',
      'GET /locks/presence',
      'POST /locks/presence',
      'POST /locks/presence/leave',
      'DELETE /locks/presence',
    ]);
  });

  it('selects one author and fails closed after verified rollback', async () => {
    const app = mounted();
    const path = `/api/v1/locks?workspace_id=${user.workspaceId}&objectType=folder&objectId=rollback`;
    expect((await authenticatedRequest(app, 'GET', path, user.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(cutoverKey);
    expect(active).toMatchObject({
      activeAuthor: LOCKS_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-locks-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await cutovers.rollback(cutoverKey, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(cutoverKey)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, user.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('authenticates exact paths and disables without a fallback or duplicate prefix', async () => {
    const path = '/api/v1/locks?objectType=initiative&objectId=auth';
    expect((await mounted().request(path)).status).toBe(401);
    expect(await cutovers.find(cutoverKey)).toBeNull();
    expect((await mounted(false).request(path)).status).toBe(404);
    expect(await cutovers.find(cutoverKey)).toBeNull();

    const ports = fakePorts();
    const app = mounted(true, ports);
    expect((await authenticatedRequest(app, 'GET', path, user.sessionToken!)).status).toBe(200);
    expect((await authenticatedRequest(
      app, 'GET', '/api/v1/locks/locks?objectType=initiative&objectId=auth', user.sessionToken!,
    )).status).toBe(404);
    expect((await authenticatedRequest(
      app,
      'POST',
      '/api/v1/locks',
      user.sessionToken!,
      { objectType: 'initiative', objectId: 'injected' },
    )).status).toBe(201);
    expect(ports.locks.acquire).toHaveBeenCalledTimes(1);
  });
});
