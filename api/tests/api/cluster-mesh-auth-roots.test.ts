import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { createIdpApp } from '../../../apps/auth-idp/idp-app';
import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createAuthNamespaceModule,
  type CreateAuthNamespaceModuleOptions,
} from '../../src/routes/namespaces/auth';
import { AUTH_AUTHOR, type AuthCompositionRoot } from '../../src/routes/namespaces/auth-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';

const store = new PostgresClusterMeshCutoverStore();
const key = (compositionRoot: AuthCompositionRoot) => ({
  compositionRoot,
  namespace: '/auth' as const,
});
const clear = (compositionRoot: AuthCompositionRoot) =>
  db.delete(clusterMeshNamespaceCutovers).where(and(
    eq(clusterMeshNamespaceCutovers.compositionRoot, compositionRoot),
    eq(clusterMeshNamespaceCutovers.namespace, '/auth'),
  ));

const projection = (
  compositionRoot: AuthCompositionRoot,
): CreateAuthNamespaceModuleOptions['projection'] => compositionRoot === 'product'
  ? {
      accountPath: '/me',
      authPath: '/auth',
      oauthAuthorizePath: '/api/v1/oauth/authorize',
    }
  : {
      accountPath: '/me',
      authPath: '',
      oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
    };

const buildCandidate = (compositionRoot: AuthCompositionRoot): Hono => {
  const rootPath = compositionRoot === 'product' ? '/api/v1' : '/api/v1/auth';
  const sessionPath = '/api/v1/auth/session';
  const oauthPath = compositionRoot === 'product'
    ? '/api/v1/oauth/authorize'
    : '/api/v1/auth/oauth/authorize';
  return new Hono()
    .route(rootPath, createClusterMeshPlugin({
      runtime: clusterMeshAdapter.sessionControl!.runtime,
      namespaces: [createAuthNamespaceModule({
        compositionRoot,
        projection: projection(compositionRoot),
      })],
      mounts: { '/auth': '/' },
    }))
    .get(sessionPath, (c) => c.body(null, 204))
    .get(oauthPath, (c) => c.body(null, 204));
};

afterEach(async () => Promise.all([clear('product'), clear('auth-idp')]));

describe('cluster mesh auth roots', () => {
  it('exposes one final identity projection in each application root', async () => {
    await Promise.all([clear('product'), clear('auth-idp')]);
    const idp = createIdpApp();

    expect((await productApp.request('/api/v1/auth/health')).status).toBe(200);
    expect((await idp.request('/api/v1/auth/health')).status).toBe(200);
    expect((await productApp.request('/api/v1/auth/oauth/authorize')).status).toBe(404);
    expect((await idp.request('/api/v1/oauth/token', { method: 'POST' })).status).toBe(404);
    expect((await productApp.request('/api/v1/me')).status).toBe(401);
    expect((await idp.request('/api/v1/auth/me')).status).toBe(401);
  });

  it.each(['product', 'auth-idp'] as const)(
    'keeps exact %s routes fenced through rollback without intercepting adjacent facades',
    async (compositionRoot) => {
      await clear(compositionRoot);
      const candidate = buildCandidate(compositionRoot);

      const candidateHealth = await candidate.request('/api/v1/auth/health');
      expect(candidateHealth.status).toBe(200);
      await expect(candidateHealth.json()).resolves.toEqual({ status: 'ok', service: 'auth' });

      const request = new Request('http://localhost/api/v1/auth/email/verify-request', {
        body: JSON.stringify({ email: 'invalid' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const candidateIntent = await candidate.request(request);
      expect(candidateIntent.status).toBe(400);
      await expect(candidateIntent.json()).resolves.toMatchObject({
        error: { code: 'invalid_input' },
      });

      const active = await store.find(key(compositionRoot));
      expect(active).toMatchObject({ activeAuthor: AUTH_AUTHOR, status: 'active' });
      expect(active?.shadowComparison).toMatchObject({ effectsDuplicated: false });

      await store.rollback(key(compositionRoot), active!.previousGenerationId!);
      await expect(store.verifyRollback(key(compositionRoot))).resolves.toMatchObject({
        reversible: true,
      });
      const blocked = await candidate.request('/api/v1/auth/health');
      expect(blocked.status).toBe(503);
      await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });

      expect((await candidate.request('/api/v1/auth/session')).status).toBe(204);
      const oauthPath = compositionRoot === 'product'
        ? '/api/v1/oauth/authorize'
        : '/api/v1/auth/oauth/authorize';
      expect((await candidate.request(oauthPath)).status).toBe(204);
    },
  );
});
