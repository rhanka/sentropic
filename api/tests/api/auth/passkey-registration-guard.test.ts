import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { db } from '../../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../../src/db/control-schema';
import { createAuthNamespaceModule } from '../../../src/routes/namespaces/auth';
import { clusterMeshAdapter } from '../../../src/services/cluster-mesh-adapter';

// A preprod IdP shares the parent RP ID with prod: a registration ceremony there could replace the
// user's prod passkey on the authenticator (same RP ID and user handle). It is refused by configuration.
const clearIdpFence = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'auth-idp'),
  eq(clusterMeshNamespaceCutovers.namespace, '/auth'),
));

const idpCandidate = (passkeyRegistration: 'enabled' | 'disabled'): Hono => new Hono()
  .route('/api/v1/auth', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createAuthNamespaceModule({
      compositionRoot: 'auth-idp', passkeyRegistration,
      projection: { accountPath: '/me', authPath: '', oauthAuthorizePath: '/api/v1/auth/oauth/authorize' },
    })],
    mounts: { '/auth': '/' },
  }));

const post = (app: Hono, path: string, body: unknown) => app.request(`/api/v1/auth${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

afterEach(clearIdpFence);

describe('IdP passkey registration guard', () => {
  it.each(['/register/options', '/register/verify'])(
    'should refuse %s with a closed code before any author fence write when registration is disabled', async (path) => {
      await clearIdpFence();
      const response = await post(idpCandidate('disabled'), path, { email: 'subject@example.test' });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: { code: 'passkey_registration_disabled',
        message: 'Passkey registration is disabled on this identity provider.' } });
      expect(await db.select().from(clusterMeshNamespaceCutovers).where(and(
        eq(clusterMeshNamespaceCutovers.compositionRoot, 'auth-idp'),
        eq(clusterMeshNamespaceCutovers.namespace, '/auth'),
      ))).toEqual([]);
    });

  it('should keep the sign-in ceremony reachable when registration is disabled', async () => {
    const response = await post(idpCandidate('disabled'), '/login/options', {});
    expect(response.status).toBe(200);
  });

  it('should keep registration reachable when registration is enabled', async () => {
    const response = await post(idpCandidate('enabled'), '/register/options', { email: 'subject@example.test' });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'email_verification_required' } });
  });
});
