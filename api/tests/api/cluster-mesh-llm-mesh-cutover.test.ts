import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { app as productApp } from '../../src/app';
import { createLlmMeshNamespaceModule } from '../../src/routes/namespaces/llm-mesh';
import { LLM_MESH_AUTHOR } from '../../src/routes/namespaces/llm-mesh-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const store = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/llm-mesh' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/llm-mesh'),
));
const candidateApp = (enabled = true) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createLlmMeshNamespaceModule({ enabled })],
  mounts: { '/llm-mesh': '/' },
}));

describe('cluster mesh llm-mesh cutover', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    await clearCutover();
    admin = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearCutover();
    await cleanupAuthData();
  });

  it('shadows catalog and account availability, validates enrollment intent, and rolls back', async () => {
    for (const path of ['/api/v1/models/catalog', '/api/v1/models/provider-readiness'] as const) {
      const response = await authenticatedRequest(productApp, 'GET', path, admin.sessionToken!);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.any(Object));
    }
    const duplicate = await authenticatedRequest(
      productApp, 'GET', '/api/v1/llm-mesh/models/catalog', admin.sessionToken!,
    );
    expect(duplicate.status).toBe(404);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalidIntent = await authenticatedRequest(
      productApp,
      'POST',
      '/api/v1/settings/provider-connections/codex/enrollment/complete',
      admin.sessionToken!,
      { enrollmentId: '' },
    );
    expect(invalidIntent.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const active = await store.find(key);
    expect(active).toMatchObject({
      activeAuthor: LLM_MESH_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-llm-mesh-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await store.rollback(key, active!.previousGenerationId!);
    await expect(store.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(
      productApp,
      'GET',
      '/api/v1/models/catalog',
      admin.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('keeps provider administration privileged while catalog remains authenticated', async () => {
    const editor = await createAuthenticatedUser('editor');
    const catalog = await authenticatedRequest(
      productApp, 'GET', '/api/v1/models/catalog', editor.sessionToken!,
    );
    const providers = await authenticatedRequest(
      productApp, 'GET', '/api/v1/settings/provider-connections', editor.sessionToken!,
    );
    expect(catalog.status).toBe(200);
    expect(providers.status).toBe(403);
  });

  it('keeps public health outside the llm-mesh authentication fence', async () => {
    const health = await productApp.request('/api/v1/health');
    const catalog = await productApp.request('/api/v1/models/catalog');

    expect(health.status).toBe(200);
    expect(catalog.status).toBe(401);
  });

  it('is disableable without selecting a fallback enrollment authority', async () => {
    const disabled = candidateApp(false);
    const response = await authenticatedRequest(
      disabled, 'GET', '/api/v1/models/catalog', admin.sessionToken!,
    );
    expect(response.status).toBe(404);
    expect(await store.find(key)).toBeNull();
  });
});
