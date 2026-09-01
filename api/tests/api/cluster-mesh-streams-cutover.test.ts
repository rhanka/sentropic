import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createStreamsNamespaceModule,
  createStreamsTransportRouter,
  STREAM_PATHS,
} from '../../src/routes/namespaces/streams';
import { STREAMS_AUTHOR } from '../../src/routes/namespaces/streams-cutover';
import type { StreamsNamespacePorts } from '../../src/routes/namespaces/streams-ports';
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
const fakePorts = (): StreamsNamespacePorts => ({
  retentionDays: 7,
  outbox: { listActive: vi.fn(async () => []), read: vi.fn(async () => []), readOne: vi.fn(async () => null) },
  chat: { read: vi.fn(async ({ streamId }) => [
    { streamId, eventType: 'content_delta', sequence: 2, data: { delta: 'B' } },
  ]) },
  jobs: {
    canRead: vi.fn(async () => false),
    listActive: vi.fn(async () => []),
    readSnapshot: vi.fn(async () => null),
  },
  business: {
    canRead: vi.fn(async () => false),
    readOrganization: vi.fn(async () => null),
    readFolder: vi.fn(async () => null),
    readInitiative: vi.fn(async () => null),
  },
  workspaces: {
    resolveTarget: vi.fn(async ({ principal }) => principal.workspaceId),
    canObserve: vi.fn(async () => false),
  },
  comments: { canObserve: vi.fn(async () => false) },
  locks: {
    clearForUser: vi.fn(async () => undefined),
    readSnapshot: vi.fn(async () => null),
    readPresence: vi.fn(async () => []),
  },
  notifications: { subscribe: vi.fn(async () => async () => undefined) },
});

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

  it('preserves the shadowed active envelope and read-only route intent after cutover', async () => {
    const path = '/api/v1/streams/active?since_minutes=360&limit=200';
    const product = await authenticatedRequest(productApp, 'GET', path, user.sessionToken!);
    const shadow = await authenticatedRequest(candidate(), 'GET', path, user.sessionToken!);
    expect(shadow.status).toBe(product.status);
    expect(await shadow.text()).toBe(await product.text());

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

  it('replays an injected cursor envelope and rejects oversized intent before dispatch', async () => {
    const ports = fakePorts();
    const transport = createStreamsTransportRouter(ports);
    const app = new Hono();
    app.use('/streams/sse', async (context, next) => {
      context.set('user', { userId: user.id, workspaceId: user.workspaceId, role: 'editor' });
      await next();
    });
    app.route('/streams', transport);
    const oversized = new URLSearchParams();
    for (let index = 0; index < 201; index += 1) oversized.append('streamIds', `s-${index}`);
    expect((await app.request(`/streams/sse?${oversized}`)).status).toBe(400);
    expect(ports.chat.read).not.toHaveBeenCalled();

    const cursor = Buffer.from(JSON.stringify({ 'chat-1': 1 })).toString('base64url');
    const abort = new AbortController();
    const response = await app.request(`/streams/sse?streamIds=chat-1&cursor=${cursor}`, {
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const wire = decoder.decode((await reader.read()).value)
      + decoder.decode((await reader.read()).value);
    abort.abort();
    expect(wire).toContain('event: content_delta\nid: chat-1:2');
    expect(ports.chat.read).toHaveBeenCalledWith(expect.objectContaining({ sinceSequence: 1 }));
  });
});
