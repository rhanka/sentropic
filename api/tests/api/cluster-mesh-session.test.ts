import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createIdpApp } from '../../../apps/auth-idp/idp-app';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';

const store = new PostgresClusterMeshCutoverStore();
const key = (compositionRoot: 'product' | 'auth-idp') => ({
  compositionRoot,
  namespace: '/session' as const,
});

async function clearCutover(compositionRoot: 'product' | 'auth-idp') {
  await db.delete(clusterMeshNamespaceCutovers).where(and(
    eq(clusterMeshNamespaceCutovers.compositionRoot, compositionRoot),
    eq(clusterMeshNamespaceCutovers.namespace, '/session'),
  ));
}

afterEach(async () => {
  await clearCutover('product');
  await clearCutover('auth-idp');
});

describe('cluster mesh session cutover', () => {
  it('selects one product author, persists shadow evidence, and fails closed after rollback', async () => {
    await clearCutover('product');
    const response = await app.request('/api/v1/auth/session');
    expect(response.status).toBe(401);

    const active = await store.find(key('product'));
    expect(active).toMatchObject({
      selectedGenerationId: 'cluster-mesh-session-v1',
      previousGenerationId: 'legacy-auth-session-product',
      activeAuthor: 'cluster-mesh-session-module',
      status: 'active',
      shadowComparison: { shadowMatched: true, driveIntentValidated: true },
    });
    expect((await app.request('/api/v1/session')).status).toBe(404);

    await store.rollback(key('product'), active!.previousGenerationId!);
    await expect(store.find(key('product'))).resolves.toMatchObject({
      selectedGenerationId: 'legacy-auth-session-product',
      status: 'rolled_back',
    });
    const blocked = await app.request('/api/v1/auth/session');
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });

    const login = await app.request('/api/v1/auth/login/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(login.status).toBe(200);
    const oauth = await app.request('/api/v1/auth/oauth/end_session', {
      headers: { 'sec-fetch-mode': 'navigate' },
    });
    expect(oauth.status).toBe(200);
  });

  it('projects the same session module beneath the standalone IdP root', async () => {
    await clearCutover('auth-idp');
    const idp = createIdpApp();
    expect((await idp.request('/api/v1/auth/session')).status).toBe(401);
    expect((await idp.request('/api/v1/auth/device/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).status).toBe(200);
    await expect(store.find(key('auth-idp'))).resolves.toMatchObject({
      activeAuthor: 'cluster-mesh-session-module',
      status: 'active',
    });

    const active = await store.find(key('auth-idp'));
    await store.rollback(key('auth-idp'), active!.previousGenerationId!);
    expect((await idp.request('/api/v1/auth/session')).status).toBe(503);
    expect((await idp.request('/api/v1/auth/login/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).status).toBe(200);
    expect((await idp.request('/api/v1/auth/oauth/end_session', {
      headers: { 'sec-fetch-mode': 'navigate' },
    })).status).toBe(200);
  });
});
