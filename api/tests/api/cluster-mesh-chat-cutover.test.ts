import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { createChatNamespaceModule } from '../../src/routes/namespaces/chat';
import { CHAT_AUTHOR } from '../../src/routes/namespaces/chat-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const store = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/chat' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/chat'),
));

describe('cluster mesh chat cutover', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await clearCutover();
    await cleanupAuthData();
  });

  const buildCandidate = () => new Hono().route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createChatNamespaceModule({
      authenticate: async (context, next) => {
        context.set('user', {
          userId: user.id,
          workspaceId: user.workspaceId,
          role: 'editor',
        });
        await next();
      },
    })],
  }));

  it('selects one author and preserves the validated rollback checkpoint', async () => {
    const created = await authenticatedRequest(
      productApp,
      'POST',
      '/api/v1/chat/sessions',
      user.sessionToken!,
      { sessionTitle: 'Shadow evidence' },
    );
    expect(created.status).toBe(200);

    const mountedRead = await authenticatedRequest(
      productApp,
      'GET',
      '/api/v1/chat/sessions',
      user.sessionToken!,
    );
    expect(mountedRead.status).toBe(200);
    expect((await mountedRead.json()).sessions).toHaveLength(1);

    const invalidPayload = { primaryContextType: 'invalid-context' };
    const invalidIntent = await authenticatedRequest(
      productApp,
      'POST',
      '/api/v1/chat/sessions',
      user.sessionToken!,
      invalidPayload,
    );
    expect(invalidIntent.status).toBe(400);

    const afterIntent = await authenticatedRequest(
      productApp,
      'GET',
      '/api/v1/chat/sessions',
      user.sessionToken!,
    );
    expect((await afterIntent.json()).sessions).toHaveLength(1);
    const active = await store.find(key);
    expect(active).toMatchObject({
      activeAuthor: CHAT_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-chat-v1',
      shadowComparison: { effectsDuplicated: false },
    });

    await store.rollback(key, active!.previousGenerationId!);
    await expect(store.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(
      productApp,
      'GET',
      '/api/v1/chat/sessions',
      user.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('is disableable without mounting or selecting a fallback author', async () => {
    const app = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime: clusterMeshAdapter.sessionControl!.runtime,
      namespaces: [createChatNamespaceModule({ enabled: false })],
    }));
    expect((await app.request('/api/v1/chat/sessions')).status).toBe(404);
    expect(await store.find(key)).toBeNull();
  });
});
