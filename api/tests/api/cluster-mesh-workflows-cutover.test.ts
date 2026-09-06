import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { createWorkflowsNamespaceModule } from '../../src/routes/namespaces/workflows';
import { WORKFLOWS_AUTHOR } from '../../src/routes/namespaces/workflows-cutover';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { queueManager } from '../../src/services/queue-manager';
import { todoOrchestrationService } from '../../src/services/todo-orchestration';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const store = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/workflows' as const };
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/workflows'),
));
const candidateApp = (enabled = true) => new Hono()
  .route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createWorkflowsNamespaceModule({ enabled })],
    mounts: { '/workflows': '/' },
  }))
  .get('/api/v1/health', (context) => context.json({ status: 'ok' }));

describe('cluster mesh workflows cutover', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    await clearCutover();
    admin = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearCutover();
    await cleanupAuthData();
  });

  it('shadows workflow reads and validates transition and job intents before rollback', async () => {
    const path = `/api/v1/workflow-config?workspace_id=${admin.workspaceId}`;
    const read = await authenticatedRequest(productApp, 'GET', path, admin.sessionToken!);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual(expect.objectContaining({ items: expect.any(Array) }));

    const startTask = vi.spyOn(todoOrchestrationService, 'startTask');
    const invalidTransition = await authenticatedRequest(
      productApp, 'POST', '/api/v1/tasks/task-1/start', admin.sessionToken!, { mode: 'invalid' },
    );
    expect(invalidTransition.status).toBe(400);
    expect(startTask).not.toHaveBeenCalled();

    vi.spyOn(queueManager, 'getJobStatus').mockResolvedValue(null);
    const cancelJob = vi.spyOn(queueManager, 'cancelJob');
    const invalidJob = await authenticatedRequest(
      productApp, 'POST', '/api/v1/queue/jobs/missing/cancel', admin.sessionToken!,
    );
    expect(invalidJob.status).toBe(404);
    expect(cancelJob).not.toHaveBeenCalled();

    const active = await store.find(key);
    expect(active).toMatchObject({
      activeAuthor: WORKFLOWS_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-workflows-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await store.rollback(key, active!.previousGenerationId!);
    await expect(store.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(
      productApp, 'GET', path, admin.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('keeps anonymous health outside the enumerated workflow authentication fence', async () => {
    expect((await productApp.request('/api/v1/health')).status).toBe(200);
    expect((await productApp.request('/api/v1/workflow-config')).status).toBe(401);
    expect((await productApp.request('/api/v1/workflows/workflow-config')).status).toBe(404);
  });

  it('is disableable without selecting a fallback workflow author', async () => {
    const response = await authenticatedRequest(
      candidateApp(false), 'GET', '/api/v1/workflow-config', admin.sessionToken!,
    );
    expect(response.status).toBe(404);
    expect(await store.find(key)).toBeNull();
  });
});
