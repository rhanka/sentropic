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
import type { StreamNotification, StreamsNamespacePorts } from '../../src/routes/namespaces/streams-ports';
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

  it.each(['initiative', 'chat', 'initiative-stream'])('should deliver %s updates emitted during connection startup', async (kind) => {
    const ports = fakePorts();
    let finishInitial!: () => void;
    const initialGate = new Promise<void>((resolve) => { finishInitial = resolve; });
    ports.jobs.listActive = vi.fn(async () => { if (kind !== 'initiative-stream') await initialGate; return []; });
    let notify: ((notification: StreamNotification) => void) | undefined;
    ports.notifications.subscribe = vi.fn(async ({ onNotification }) => {
      notify = onNotification;
      return async () => undefined;
    });
    ports.business.readInitiative = vi.fn(async () => ({ constraints: 'updated during startup' }));
    const streamId = kind === 'initiative-stream' ? 'initiative_1' : 'chat-1';
    const events = (kind === 'initiative-stream' ? [2] : [2, 3]).map((sequence) => ({
      streamId, eventType: 'content_delta', sequence, data: { delta: `${sequence}` },
    }));
    ports.chat.read = vi.fn(async ({ sinceSequence }) => events.filter((event) => event.sequence > sinceSequence));
    let beginRead!: () => void;
    const readStarted = new Promise<void>((resolve) => { beginRead = resolve; });
    ports.business.canRead = vi.fn(async () => true);
    ports.outbox.read = vi.fn(async ({ sinceSequence }) => {
      const batch = events.filter((event) => event.sequence > sinceSequence);
      if (sinceSequence === 1) { beginRead(); await initialGate; }
      return batch;
    });
    ports.outbox.readOne = vi.fn(async ({ sequence }) => events.find((event) => event.sequence === sequence) ?? null);
    const app = new Hono();
    app.use('/streams/sse', async (context, next) => {
      context.set('user', { userId: user.id, workspaceId: user.workspaceId, role: 'editor' });
      await next();
    });
    app.route('/streams', createStreamsTransportRouter(ports));
    const abort = new AbortController();
    const cursor = Buffer.from(JSON.stringify({ [streamId]: 1 })).toString('base64url');
    const response = await app.request(`/streams/sse?streamIds=${streamId}&cursor=${cursor}`, { signal: abort.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      expect(response.status).toBe(200);
      expect(decoder.decode((await reader.read()).value)).toContain(': connected');
      // Initial snapshots are blocked: the old transport has returned 200 but has not subscribed.
      if (kind === 'initiative-stream') {
        await readStarted;
        events.push(...[3, 4].map((sequence) => ({
          streamId, eventType: 'content_delta', sequence, data: { delta: `${sequence}` },
        })));
      }
      if (kind === 'initiative') {
        notify?.({ channel: 'initiative_events', payload: JSON.stringify({ initiative_id: 'initiative-1' }) });
      } else {
        for (const sequence of kind === 'initiative-stream' ? [3, 4] : [2, 3]) {
          notify?.({ channel: 'stream_events', payload: JSON.stringify({ stream_id: streamId, sequence }) });
        }
      }
      finishInitial();
      let wire = '';
      while (!wire.includes('event: ping\n')) wire += decoder.decode((await reader.read()).value);
      if (kind === 'initiative') {
        expect(ports.business.readInitiative).toHaveBeenCalledWith({ id: 'initiative-1', workspaceId: user.workspaceId });
        while (!wire.includes('event: usecase_update\n')) wire += decoder.decode((await reader.read()).value);
        expect(wire).toContain('updated during startup');
      } else if (kind === 'initiative-stream') {
        while (!wire.includes('id: initiative_1:4\n')) wire += decoder.decode((await reader.read()).value);
        expect(wire.match(/id: initiative_1:\d+/g)).toEqual(['id: initiative_1:2', 'id: initiative_1:3', 'id: initiative_1:4']);
      } else {
        expect(wire.match(/id: chat-1:\d+/g)).toEqual(['id: chat-1:2', 'id: chat-1:3']);
        expect(ports.chat.read).toHaveBeenLastCalledWith(expect.objectContaining({ sinceSequence: 3 }));
      }
    } finally {
      finishInitial();
      abort.abort();
      await reader.cancel();
    }
  });

  it('should refresh presence after notifications are subscribed on each connection', async () => {
    const ports = fakePorts();
    const app = new Hono();
    app.use('/streams/sse', async (context, next) => {
      context.set('user', { userId: user.id, workspaceId: user.workspaceId, role: 'editor' });
      await next();
    });
    app.route('/streams', createStreamsTransportRouter(ports));
    for (let connection = 0; connection < 2; connection += 1) {
      const abort = new AbortController();
      const response = await app.request('/streams/sse', { signal: abort.signal });
      const reader = response.body!.getReader();
      try {
        const decoder = new TextDecoder();
        expect(decoder.decode((await reader.read()).value)).toContain(': connected');
        const heartbeat = decoder.decode((await reader.read()).value);
        expect(heartbeat).toContain('event: ping\n');
        expect(ports.notifications.subscribe).toHaveBeenCalledTimes(connection + 1);
      } finally {
        abort.abort();
        await reader.cancel();
      }
    }
  }, 2_000);
});
