import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as legacyApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { agentDefinitions } from '../../src/db/schema';
import { createAgentsNamespaceModule } from '../../src/routes/namespaces/agents';
import { AGENTS_AUTHOR } from '../../src/routes/namespaces/agents-cutover';
import { createProductAgentsPorts } from '../../src/routes/namespaces/agents-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const pass: MiddlewareHandler = async (_context, next) => next();
const store = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/agents' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/agents'),
));

describe('cluster mesh agents cutover', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    await clearCutover();
    admin = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearCutover();
    if (admin?.workspaceId) {
      await db.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, admin.workspaceId));
    }
    await cleanupAuthData();
  });

  const candidateApp = (enabled = true, authorize?: MiddlewareHandler) => {
    const ports = createProductAgentsPorts();
    return {
      ports,
      app: new Hono().route('/api/v1', createClusterMeshPlugin({
        runtime: clusterMeshAdapter.sessionControl!.runtime,
        namespaces: [createAgentsNamespaceModule({ enabled, ports, authorize })],
        mounts: { '/agents': '/' },
      })),
    };
  };

  it('shadows reads byte-for-byte and validates configuration intent without effects', async () => {
    const create = await authenticatedRequest(
      legacyApp, 'PUT', '/api/v1/agent-config', admin.sessionToken!,
      { items: [{ key: 'shadow-agent', name: 'Shadow agent', sourceLevel: 'admin' }] },
    );
    expect(create.status).toBe(200);

    const candidate = candidateApp(true, pass);
    for (const path of ['/api/v1/agent-config', '/api/v1/prompts']) {
      const legacy = await authenticatedRequest(legacyApp, 'GET', path, admin.sessionToken!);
      const shadow = await authenticatedRequest(candidate.app, 'GET', path, admin.sessionToken!);
      expect(shadow.status).toBe(legacy.status);
      expect(await shadow.text()).toBe(await legacy.text());
    }

    const upsert = vi.spyOn(candidate.ports.flow, 'upsertMany');
    const invalidConfig = await authenticatedRequest(
      candidate.app, 'PUT', '/api/v1/agent-config', admin.sessionToken!, { items: [] },
    );
    expect(invalidConfig.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();

    const updateProfiles = vi.spyOn(candidate.ports.catalog, 'updatePromptProfiles');
    const invalidProfiles = await authenticatedRequest(
      candidate.app, 'PUT', '/api/v1/prompts', admin.sessionToken!, { prompts: [{}] },
    );
    expect(invalidProfiles.status).toBe(400);
    expect(updateProfiles).not.toHaveBeenCalled();
  });

  it('selects one author and fails closed after verified rollback', async () => {
    const candidate = candidateApp();
    const response = await authenticatedRequest(
      candidate.app, 'GET', '/api/v1/agent-config', admin.sessionToken!,
    );
    expect(response.status).toBe(200);
    const active = await store.find(key);
    expect(active).toMatchObject({
      activeAuthor: AGENTS_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-agents-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await store.rollback(key, active!.previousGenerationId!);
    await expect(store.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(
      candidate.app, 'GET', '/api/v1/agent-config', admin.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('is disableable without selecting a fallback author', async () => {
    const candidate = candidateApp(false);
    const response = await authenticatedRequest(
      candidate.app, 'GET', '/api/v1/agent-config', admin.sessionToken!,
    );
    expect(response.status).toBe(404);
    expect(await store.find(key)).toBeNull();
  });
});
