import { randomUUID } from 'node:crypto';

import { createClusterMeshModules, createClusterMeshPlugin, type ClusterMeshModules } from '@sentropic/cluster-mesh';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { app as productApp } from '../../src/app';
import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import { createGwNamespaceModule, GW_AUTHOR } from '../../src/routes/namespaces/gw';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { insertModelPricing, routePartitionHash, type RoutePartitionConfig } from '../../src/services/llm-metering';
import { createApplicationGatewayRoutePlane } from '../../src/services/llm-runtime/gateway-route-plane';

const run = randomUUID().replace(/-/g, '').slice(0, 10);
const TENANT = `gw-${run}`;
const store = new PostgresClusterMeshCutoverStore();
const key = { compositionRoot: 'product' as const, namespace: '/gw' as const };
const generationId = () => clusterMeshAdapter.sessionControl!.runtime.generation.generationId;
const clear = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, 'product'),
  eq(clusterMeshNamespaceCutovers.namespace, '/gw'),
));

const partition = (revision: string, users: readonly string[]): RoutePartitionConfig => {
  const tenants = { [TENANT]: { product: [...users] } };
  return { revision, hash: routePartitionHash(revision, tenants), tenants };
};
const R1 = partition('r1', ['user-1']);
const R2 = partition('r2', ['user-1', 'user-2']);

/** Operator activation (outside both hosts): dispatch authority plus the pinned partition evidence only. */
const activate = (evidence: RoutePartitionConfig, previous?: RoutePartitionConfig) => store.activate({
  ...key, selectedGenerationId: generationId(), previousGenerationId: 'application-llm-adapter-v1',
  activeAuthor: GW_AUTHOR, status: 'active',
  shadowComparison: { strategy: 'operator-activation', partition: { revision: evidence.revision, hash: evidence.hash } },
  rollbackCheckpoint: {
    generationId: 'application-llm-adapter-v1', activeAuthor: 'application-llm-adapter',
    ...(previous ? { partition: { revision: previous.revision, hash: previous.hash } } : {}),
  },
});

const buildCandidate = (options: { observeShadow?: (value: unknown) => void; modules?: ClusterMeshModules } = {}) => {
  const generate = vi.fn().mockResolvedValue({
    id: 'gateway-response-1', providerId: 'openai', modelId: 'gpt-5.6-terra',
    message: { role: 'assistant', content: 'candidate' }, text: 'candidate',
    toolCalls: [], finishReason: 'stop',
    usage: { inputTokens: 2, outputTokens: 1 },
  });
  const stream = vi.fn();
  const routePlane = createApplicationGatewayRoutePlane({
    dispatch: { generate, stream },
    ...(options.observeShadow ? { observeShadow: options.observeShadow } : {}),
  });
  const build = async () => new Hono().route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [await createGwNamespaceModule({
      routePlane,
      ...(options.modules ? { modules: options.modules } : {}),
      authenticate: async (_context, next) => next(),
      resolveCaller: () => ({
        tenantId: TENANT, workspaceId: `${TENANT}-ws`, principalId: 'user-1',
        ownerScopeRef: `workspace:${TENANT}-ws:principal:user-1`, source: 'test', correlationId: 'request-1',
      }),
    })],
  }));
  return { build, generate, stream };
};

const chat = { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'hello' }] }) };

beforeAll(async () => {
  process.env.LLM_GATEWAY_PARTITION = JSON.stringify(R1);
  await db.execute(sql`DELETE FROM control.model_pricing WHERE provider_id = 'openai' AND model_id = 'gpt-5.6-terra'`);
  await insertModelPricing(db, { id: `gw-${run}-price`, providerId: 'openai', modelId: 'gpt-5.6-terra',
    inputMicroUsdPerMtok: 1_000_000, outputMicroUsdPerMtok: 2_000_000, effectiveFrom: new Date(Date.now() - 86_400_000) });
  await db.execute(sql`INSERT INTO control.tenant_budget_strategy (id, tenant_id, funding_mode, key_sourcing_mode)
    VALUES (${`${TENANT}-strategy`}, ${TENANT}, 'tenant_pool', 'platform')`);
  await db.execute(sql`INSERT INTO control.budgets (id, tenant_id, scope_kind, scope_key, cap_micro_usd, reset_at)
    VALUES (${`${TENANT}-bucket`}, ${TENANT}, 'tenant', ${TENANT}, 1000000, now() + interval '20 days')`);
});

afterEach(async () => {
  process.env.LLM_GATEWAY_PARTITION = JSON.stringify(R1);
  await clear();
});

afterAll(async () => {
  delete process.env.LLM_GATEWAY_PARTITION;
  for (const table of ['cost_ledger', 'blocked_attempts', 'budget_holds', 'budgets', 'tenant_budget_strategy']) {
    await db.execute(sql`DELETE FROM ${sql.raw(`control.${table}`)} WHERE tenant_id = ${TENANT}`);
  }
  await db.execute(sql`DELETE FROM control.event_outbox WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM control.model_pricing WHERE id = ${`gw-${run}-price`}`);
});

describe('cluster mesh gateway namespace', () => {
  it('mounts the real gateway factory on the product root once an operator activated the author', async () => {
    await clear();
    expect((await productApp.request('/api/v1/gw/healthz')).status).toBe(503);
    await activate(R1);
    const response = await productApp.request('/api/v1/gw/healthz');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', mode: 'personal-passthrough' });
    expect((await productApp.request('/api/v1/v1/models')).status).toBe(404);
    expect((await productApp.request('/api/v1/gw/gw/healthz')).status).toBe(404);
  });

  it('builds the gateway router exactly once through the shared cluster gateway module', async () => {
    const registry = createClusterMeshModules();
    const factory = vi.fn();
    const modules: ClusterMeshModules = {
      ...registry,
      async load(id) {
        const loaded = await registry.load(id);
        if (id !== 'gateway') return loaded;
        const gateway = loaded as typeof import('@sentropic/llm-gateway');
        return { ...gateway, createGatewayRouter: factory.mockImplementation(gateway.createGatewayRouter) };
      },
    } as ClusterMeshModules;
    await activate(R1);
    const app = await buildCandidate({ modules }).build();
    for (let index = 0; index < 3; index += 1) expect((await app.request('/api/v1/gw/healthz')).status).toBe(200);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('never writes the cutover at boot or request time, and the author fence refuses a rolled-back author', async () => {
    await clear();
    const shadows: unknown[] = [];
    const { build, generate } = buildCandidate({ observeShadow: (value) => shadows.push(value) });
    const app = await build();
    expect((await app.request('/api/v1/gw/v1/chat/completions', chat)).status).toBe(503);
    expect(await store.find(key)).toBeNull();

    await activate(R1);
    const response = await app.request('/api/v1/gw/v1/chat/completions', chat);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      model: 'gpt-5.6-terra', choices: [{ message: { content: 'candidate' } }],
    });
    expect(shadows).toHaveLength(1);
    expect(generate).toHaveBeenCalledOnce();

    const active = await store.find(key);
    await store.rollback(key, active!.previousGenerationId!);
    await expect(store.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await app.request('/api/v1/gw/healthz');
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('updates and rolls back the partition revision without touching the dispatch generation or author', async () => {
    const app = await buildCandidate().build();
    await activate(R1);
    const before = await store.find(key);
    expect((await app.request('/api/v1/gw/readyz')).status).toBe(200);

    // Configuration moves to r2 before the operator pins it: mismatch fails closed.
    process.env.LLM_GATEWAY_PARTITION = JSON.stringify(R2);
    expect((await app.request('/api/v1/gw/readyz')).status).toBe(503);
    expect((await app.request('/api/v1/gw/v1/chat/completions', chat)).status).toBe(503);

    await activate(R2, R1);
    expect((await app.request('/api/v1/gw/readyz')).status).toBe(200);
    const updated = await store.find(key);
    expect(updated).toMatchObject({ rollbackCheckpoint: { partition: { revision: 'r1', hash: R1.hash } } });

    // Rollback to r1: restore the configuration and its pinned evidence.
    process.env.LLM_GATEWAY_PARTITION = JSON.stringify(R1);
    await activate(R1, R2);
    expect((await app.request('/api/v1/gw/readyz')).status).toBe(200);
    for (const record of [updated, await store.find(key)]) {
      expect(record).toMatchObject({
        selectedGenerationId: before!.selectedGenerationId, previousGenerationId: before!.previousGenerationId,
        activeAuthor: before!.activeAuthor, status: 'active',
      });
    }
  });

  it('reports not-ready (503) when a dependency is missing', async () => {
    await activate(R1);
    delete process.env.LLM_GATEWAY_PARTITION;
    const app = await buildCandidate().build();
    expect((await app.request('/api/v1/gw/readyz')).status).toBe(503);
    expect((await app.request('/api/v1/gw/healthz')).status).toBe(200);
  });

  it('is partially disableable without mounting a fallback author', async () => {
    await clear();
    const app = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime: clusterMeshAdapter.sessionControl!.runtime,
      namespaces: [await createGwNamespaceModule({ enabled: false })],
    }));
    expect((await app.request('/api/v1/gw/healthz')).status).toBe(404);
    expect(await store.find(key)).toBeNull();
  });
});
