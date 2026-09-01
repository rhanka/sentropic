import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as legacyApp } from '../../src/app';
import { requireAuth } from '../../src/middleware/auth';
import {
  createLocksTransportRouter,
  LOCK_PATHS,
} from '../../src/routes/namespaces/locks';
import type { LocksNamespacePorts } from '../../src/routes/namespaces/locks-ports';
import { productLocksPorts } from '../../src/routes/namespaces/locks-product-ports';
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

describe('cluster mesh locks pre-deletion shadow', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('matches the legacy safe read and dispatches validated mutation intent once', async () => {
    const query = `workspace_id=${user.workspaceId}&objectType=organization&objectId=shadow-object`;
    const legacy = await authenticatedRequest(
      legacyApp, 'GET', `/api/v1/locks?${query}`, user.sessionToken!,
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
});
