import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  createGwNamespaceModule,
  GW_AUTHOR,
} from '../../src/routes/namespaces/gw';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { createApplicationGatewayRoutePlane } from '../../src/services/llm-runtime/gateway-route-plane';

const store = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/gw' as const };
const clear = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/gw'),
));

const buildCandidate = (observeShadow?: (value: unknown) => void) => {
  const generate = vi.fn().mockResolvedValue({
    id: 'gateway-response-1', providerId: 'openai', modelId: 'gpt-5.6-terra',
    message: { role: 'assistant', content: 'candidate' }, text: 'candidate',
    toolCalls: [], finishReason: 'stop',
    usage: { inputTokens: 2, outputTokens: 1 },
  });
  const stream = vi.fn();
  const routePlane = createApplicationGatewayRoutePlane({
    dispatch: { generate, stream },
    ...(observeShadow ? { observeShadow } : {}),
  });
  const app = new Hono().route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createGwNamespaceModule({
      routePlane,
      authenticate: async (_context, next) => next(),
      resolveCallerOwnership: () => ({
        tenantId: 'tenant-1', workspaceId: 'workspace-1', principalId: 'user-1',
        ownerScopeRef: 'workspace-1:user-1', source: 'test', correlationId: 'request-1',
      }),
    })],
  }));
  return { app, generate, stream };
};

afterEach(clear);

describe('cluster mesh gateway namespace', () => {
  it('mounts the real gateway factory on the product root', async () => {
    await clear();
    const response = await productApp.request('/api/v1/gw/healthz');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok', mode: 'personal-passthrough',
    });
    expect((await productApp.request('/api/v1/v1/models')).status).toBe(404);
  });

  it('shadows once, dispatches once, and rolls back to the prior adapter generation', async () => {
    await clear();
    const shadows: unknown[] = [];
    const { app, generate, stream } = buildCandidate((value) => shadows.push(value));
    const response = await app.request('/api/v1/gw/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      model: 'gpt-5.6-terra', choices: [{ message: { content: 'candidate' } }],
    });
    expect(shadows).toHaveLength(1);
    expect(generate).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();

    const active = await store.find(key);
    expect(active).toMatchObject({
      activeAuthor: GW_AUTHOR, status: 'active',
      previousGenerationId: 'application-llm-adapter-v1',
      shadowComparison: { effectsDuplicated: false },
    });
    await store.rollback(key, active!.previousGenerationId!);
    await expect(store.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await app.request('/api/v1/gw/healthz');
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('is partially disableable without mounting a fallback author', async () => {
    await clear();
    const app = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime: clusterMeshAdapter.sessionControl!.runtime,
      namespaces: [createGwNamespaceModule({ enabled: false })],
    }));
    expect((await app.request('/api/v1/gw/healthz')).status).toBe(404);
    expect(await store.find(key)).toBeNull();
  });
});
