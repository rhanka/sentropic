import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { createIdpApp } from '../../../apps/auth-idp/idp-app';
import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createOAuthNamespaceModule,
  createOAuthWellKnownProjection,
  type OAuthCompositionRoot,
} from '../../src/routes/namespaces/oauth';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';

const store = new PostgresClusterMeshCutoverStore();
const key = (compositionRoot: OAuthCompositionRoot) => ({ compositionRoot, namespace: '/oauth' as const });
const clear = (compositionRoot: OAuthCompositionRoot) => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, '/oauth'),
));

const buildRoot = (compositionRoot: OAuthCompositionRoot, oauthPath: string): Hono => {
  const rootPath = compositionRoot === 'product' ? '/api/v1' : '/api/v1/auth';
  return new Hono()
    .route('/.well-known', createOAuthWellKnownProjection({ compositionRoot, publicPath: oauthPath }))
    .route(rootPath, createClusterMeshPlugin({
      runtime: clusterMeshAdapter.sessionControl!.runtime,
      namespaces: [createOAuthNamespaceModule({ compositionRoot, publicPath: oauthPath })],
    }))
    .get('/api/v1/auth/session', (c) => c.body(null, 204))
    .get('/api/v1/auth/future', (c) => c.body(null, 204));
};

afterEach(async () => Promise.all([clear('product'), clear('auth-idp')]));

describe('cluster mesh OAuth roots', () => {
  it('exposes only the final public projection in each composition root', async () => {
    await Promise.all([clear('product'), clear('auth-idp')]);
    const idp = createIdpApp();

    expect((await productApp.request('/api/v1/oauth/end_session')).status).toBe(200);
    expect((await productApp.request('/api/v1/auth/oauth/end_session')).status).toBe(404);
    expect((await idp.request('/api/v1/auth/oauth/end_session')).status).toBe(200);
    expect((await idp.request('/api/v1/oauth/token', { method: 'POST' })).status).toBe(404);
  });

  it.each([
    ['product', '/api/v1/oauth'],
    ['auth-idp', '/api/v1/auth/oauth'],
  ] as const)('cuts over %s with exact routes and a working rollback', async (compositionRoot, oauthPath) => {
    await clear(compositionRoot);
    const app = buildRoot(compositionRoot, oauthPath);
    const metadata = await app.request('http://localhost:9197/.well-known/openid-configuration');
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toMatchObject({
      authorization_endpoint: `http://localhost:9197${oauthPath}/authorize`,
      token_endpoint: `http://localhost:9197${oauthPath}/token`,
    });
    expect((await app.request(`${oauthPath}/end_session`)).status).toBe(200);

    const active = await store.find(key(compositionRoot));
    expect(active).toMatchObject({ activeAuthor: 'auth-hono-oauth-module', status: 'active' });
    expect(active?.shadowComparison).toMatchObject({ effectsDuplicated: false });
    await store.rollback(key(compositionRoot), active!.previousGenerationId!);
    await expect(store.verifyRollback(key(compositionRoot))).resolves.toMatchObject({ reversible: true });
    const blocked = await app.request(`${oauthPath}/end_session`);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
    const blockedMetadata = await app.request('/.well-known/openid-configuration');
    expect(blockedMetadata.status).toBe(503);
    await expect(blockedMetadata.json()).resolves.toEqual({ error: 'wrong_author' });

    expect((await app.request('/api/v1/auth/session')).status).toBe(204);
    expect((await app.request('/api/v1/auth/future')).status).toBe(204);
  });
});
