import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { authRouter as legacyAuthRouter } from '../../src/routes/auth';
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
  it.each(['product', 'auth-idp'] as const)(
    'matches safe reads and validated intents before deleting the %s legacy mount',
    async (compositionRoot) => {
      await clear(compositionRoot);
      const legacy = new Hono().route('/api/v1/auth', legacyAuthRouter);
      const candidate = buildCandidate(compositionRoot);

      const legacyHealth = await legacy.request('/api/v1/auth/health');
      const candidateHealth = await candidate.request('/api/v1/auth/health');
      expect(candidateHealth.status).toBe(legacyHealth.status);
      expect(await candidateHealth.json()).toEqual(await legacyHealth.json());

      const request = new Request('http://localhost/api/v1/auth/email/verify-request', {
        body: JSON.stringify({ email: 'invalid' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const [legacyIntent, candidateIntent] = await Promise.all([
        legacy.request(request.clone()),
        candidate.request(request.clone()),
      ]);
      expect(candidateIntent.status).toBe(legacyIntent.status);
      expect(await candidateIntent.json()).toEqual(await legacyIntent.json());

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
