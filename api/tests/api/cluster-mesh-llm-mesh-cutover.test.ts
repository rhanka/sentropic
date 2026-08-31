import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { app as legacyApp } from '../../src/app';
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
    const candidate = candidateApp();
    for (const [legacyPath, nextPath] of [
      ['/api/v1/models/catalog', '/api/v1/models/catalog'],
      ['/api/v1/models/provider-readiness', '/api/v1/models/provider-readiness'],
    ] as const) {
      const legacy = await authenticatedRequest(legacyApp, 'GET', legacyPath, admin.sessionToken!);
      const next = await authenticatedRequest(candidate, 'GET', nextPath, admin.sessionToken!);
      expect(next.status).toBe(legacy.status);
      await expect(next.json()).resolves.toEqual(await legacy.json());
    }

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalidIntent = await authenticatedRequest(
      candidate,
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
      candidate,
      'GET',
      '/api/v1/models/catalog',
      admin.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('keeps provider administration privileged while catalog remains authenticated', async () => {
    const editor = await createAuthenticatedUser('editor');
    const candidate = candidateApp();
    const catalog = await authenticatedRequest(
      candidate, 'GET', '/api/v1/models/catalog', editor.sessionToken!,
    );
    const providers = await authenticatedRequest(
      candidate, 'GET', '/api/v1/settings/provider-connections', editor.sessionToken!,
    );
    expect(catalog.status).toBe(200);
    expect(providers.status).toBe(403);
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
