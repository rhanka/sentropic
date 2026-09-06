import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { comments, organizations } from '../../src/db/schema';
import { createCommentsNamespaceModule } from '../../src/routes/namespaces/comments';
import { COMMENTS_AUTHOR } from '../../src/routes/namespaces/comments-cutover';
import { createProductCommentsRouterOptions } from '../../src/routes/namespaces/comments-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('cluster mesh comments cutover', () => {
  let user: TestUser;
  let organizationId: string;
  const cutovers = new PostgresClusterMeshCutoverStore();
  const key = { compositionRoot: 'product' as const, namespace: '/comments' as const };
  const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
    eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
    eq(clusterMeshNamespaceCutovers.namespace, '/comments'),
  ));

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor', `comments-cutover-${createTestId()}@example.com`);
    const response = await authenticatedRequest(
      productApp,
      'POST',
      '/api/v1/organizations',
      user.sessionToken!,
      { name: `Comments cutover ${createTestId()}`, industry: 'Technology' },
    );
    expect(response.status).toBe(201);
    organizationId = (await response.json() as { id: string }).id;
  });

  afterEach(async () => {
    await clearCutover();
    if (user.workspaceId) {
      await db.delete(comments).where(eq(comments.workspaceId, user.workspaceId));
      await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
  });

  const pluginApp = (enabled = true) => {
    const options = createProductCommentsRouterOptions();
    return new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime: clusterMeshAdapter.sessionControl!.runtime,
      namespaces: [createCommentsNamespaceModule({
        enabled,
        authenticate: async (_context, next) => next(),
        routerOptions: {
          ...options,
          authz: {
            ...options.authz,
            resolvePrincipal: async () => ({ userId: user.id, workspaceId: user.workspaceId! }),
          },
        },
      })],
      mounts: { '/comments': '/' },
    }));
  };

  it('root-mounts comments without gating anonymous health', async () => {
    expect((await productApp.request('/api/v1/health')).status).toBe(200);
    expect((await productApp.request('/api/v1/comments')).status).toBe(401);
    const doubled = await authenticatedRequest(
      productApp,
      'GET',
      '/api/v1/comments/comments',
      user.sessionToken!,
    );
    expect(doubled.status).toBe(404);
  });

  it('selects one author and fails closed after verified rollback', async () => {
    const app = pluginApp();
    const path = `/api/v1/comments?context_type=organization&context_id=${organizationId}`;
    expect((await app.request(path)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      activeAuthor: COMMENTS_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-comments-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await app.request(path);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('is disableable without selecting a fallback author', async () => {
    expect((await pluginApp(false).request('/api/v1/comments')).status).toBe(404);
    expect(await cutovers.find(key)).toBeNull();
  });
});
