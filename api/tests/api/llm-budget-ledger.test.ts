// Lot D B3c: application budget admission, route settlement and reservation reaper on the real
// Postgres of this ENV (0008 tables), then the product `/gw` and the standalone host over them.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { RouteMeteringSink, RouteRequestSettlement } from '@sentropic/llm-gateway';
import type { RouteQuote } from '@sentropic/llm-mesh';
import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHostApp, createLedgerDependencies, createRoutingDependency } from '../../../apps/llm-gateway/src/app';
import { db } from '../../src/db/client';
import { createGwNamespaceModule, GW_AUTHOR, GW_DEFAULT_OUTPUT_TOKENS } from '../../src/routes/namespaces/gw';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  createBudgetAdmission, createRouteSettlement, insertModelPricing, principalOf, reapExpiredHolds, recordLlmUsage,
  redactSettlementAttempt, routePartitionHash, PrincipalKeyError, type RoutePartitionConfig,
} from '../../src/services/llm-metering';
import { createApplicationGatewayRoutePlane } from '../../src/services/llm-runtime/gateway-route-plane';

const run = randomUUID().replace(/-/g, '').slice(0, 10);
const TENANT = `llmbl-${run}`;
const PROVIDER = `llmbl-${run}`;
const DAY = 86_400_000;
const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(query)).rows as T[];
const num = (value: unknown): number => Number(value);

const seedStrategy = (tenantId: string) => db.execute(sql`INSERT INTO control.tenant_budget_strategy
  (id, tenant_id, funding_mode, key_sourcing_mode) VALUES (${`${tenantId}-strategy`}, ${tenantId}, 'tenant_pool', 'platform')`);

const seedBucket = (tenantId: string, scopeKind: string, scopeKey: string, cap: number | null,
  extra: { workspaceId?: string; resetAt?: Date } = {}) => db.execute(sql`INSERT INTO control.budgets
  (id, tenant_id, workspace_id, scope_kind, scope_key, cap_micro_usd, reset_at)
  VALUES (${`${tenantId}-${scopeKind}-${scopeKey}`}, ${tenantId}, ${extra.workspaceId ?? null}, ${scopeKind}, ${scopeKey},
    ${cap}, ${extra.resetAt ?? new Date(Date.now() + 20 * DAY)})`);

const bucket = async (tenantId: string, scopeKind = 'tenant') => {
  const [row] = await rows<Record<string, unknown>>(sql`SELECT reserved_micro_usd, spent_micro_usd FROM control.budgets
    WHERE tenant_id = ${tenantId} AND scope_kind = ${scopeKind}`);
  return { reserved: num(row!.reserved_micro_usd), spent: num(row!.spent_micro_usd) };
};

const cleanTenant = async (tenantId: string) => {
  await db.execute(sql`DELETE FROM control.cost_ledger WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM control.blocked_attempts WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM control.event_outbox WHERE tenant_id = ${tenantId} AND aggregate_type = 'llm_request'`);
  await db.execute(sql`DELETE FROM control.budget_holds WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM control.budgets WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM control.tenant_budget_strategy WHERE tenant_id = ${tenantId}`);
};

const cost = (overrides: Partial<{ tenantId: string; principalId: string }> = {}) => ({
  tenantId: overrides.tenantId ?? TENANT, workspaceId: `${TENANT}-ws`, principalId: overrides.principalId ?? 'user-1',
  ownerScopeRef: `workspace:${TENANT}-ws:principal:user-1`, source: 'test', correlationId: 'c', callSite: 'test',
});

const quote = (candidates: Array<{ model: string; enforced?: boolean }>, maxAttempts = 1, output = 1_000): RouteQuote => ({
  quoteRef: `quote_${run}`, requestedModel: candidates[0]!.model, maxAttempts, quotedAt: new Date().toISOString(),
  policyRevision: 'default', councilRevision: 'test',
  candidates: candidates.map(({ model, enforced = true }) => ({
    providerId: PROVIDER, modelId: model, reason: 'exact' as const,
    allowance: { inputTokens: 1_000, outputTokens: output }, outputCeilingEnforced: enforced,
  })),
});

const admission = createBudgetAdmission({ database: db, ownerRef: 'test', maxOutputTokensFor: () => 10_000 });
const settlement = createRouteSettlement({ database: db });
const admit = (requestId: string, q: RouteQuote, c = cost()) => admission.admit({
  requestId, cost: c, wire: 'openai-chat-completions', quote: q,
});

beforeAll(async () => {
  // Rates in micro-USD per million tokens: cheap = 1 micro/token in, 2 out; dear = 10 in, 20 out, reasoning 30.
  for (const [model, input, output, reasoning] of [['cheap', 1_000_000, 2_000_000, null], ['dear', 10_000_000, 20_000_000, 30_000_000],
    ['codex', 1_000_000, 1_000_000, null]] as const) {
    await insertModelPricing(db, { id: `${PROVIDER}-${model}`, providerId: PROVIDER, modelId: model, inputMicroUsdPerMtok: input,
      outputMicroUsdPerMtok: output, reasoningMicroUsdPerMtok: reasoning, effectiveFrom: new Date(Date.now() - DAY) });
  }
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM control.model_pricing WHERE provider_id = ${PROVIDER}`);
});

afterEach(() => cleanTenant(TENANT));

const seedTenant = async (cap: number | null = 1_000_000) => {
  await seedStrategy(TENANT);
  await seedBucket(TENANT, 'tenant', TENANT, cap);
};

describe('budget admission over the 0008 tables', () => {
  it('reserves maxAttempts × the costliest candidate (mixed prices, fallback) on every applicable bucket', async () => {
    await seedTenant();
    await seedBucket(TENANT, 'workspace', `${TENANT}-ws`, null, { workspaceId: `${TENANT}-ws` });
    await seedBucket(TENANT, 'principal', 'user-1', null);
    await seedBucket(TENANT, 'model', `${PROVIDER}/dear`, null);
    const decision = await admit(`r1-${run}`, quote([{ model: 'cheap' }, { model: 'dear' }], 2));
    expect(decision.kind).toBe('admitted');
    // dear: 1250 input tokens (25 % margin) × 10 + 1000 output × max(20, 30 reasoning) = 12500 + 30000.
    const liability = 2 * 42_500;
    const [hold] = await rows<Record<string, unknown>>(sql`SELECT liability_micro_usd, status, budget_ids, pricing_versions
      FROM control.budget_holds WHERE request_id = ${`r1-${run}`}`);
    expect(num(hold!.liability_micro_usd)).toBe(liability);
    expect(hold!.status).toBe('held');
    expect((hold!.budget_ids as string[]).length).toBe(4);
    expect([...(hold!.pricing_versions as string[])].sort()).toEqual([`${PROVIDER}-cheap`, `${PROVIDER}-dear`]);
    for (const scope of ['tenant', 'workspace', 'principal', 'model']) expect((await bucket(TENANT, scope)).reserved).toBe(liability);
  });

  it('prices a candidate whose transport drops the output ceiling at the model maximum output', async () => {
    await seedTenant();
    await admit(`r2-${run}`, quote([{ model: 'codex', enforced: false }], 1, 100));
    // 1250 input + max(100 allowance, 10000 model max) output at 1 micro/token.
    expect((await bucket(TENANT)).reserved).toBe(1_250 + 10_000);
  });

  it('refuses over a cap with the blocking reset, one blocked_attempts row and no hold, reserve or cost row', async () => {
    const resetAt = new Date(Date.now() + 9 * DAY);
    await seedStrategy(TENANT);
    await seedBucket(TENANT, 'tenant', TENANT, 3_000, { resetAt });
    const decision = await admit(`r3-${run}`, quote([{ model: 'cheap' }]));
    expect(decision).toEqual({ kind: 'over-budget', resetAtMs: resetAt.getTime() });
    const blocked = await rows<Record<string, unknown>>(sql`SELECT reason, budget_id, quote_ref, principal_key
      FROM control.blocked_attempts WHERE request_id = ${`r3-${run}`}`);
    expect(blocked).toEqual([{ reason: 'cap', budget_id: `${TENANT}-tenant-${TENANT}`, quote_ref: `quote_${run}`, principal_key: 'user-1' }]);
    expect(await rows(sql`SELECT id FROM control.budget_holds WHERE request_id = ${`r3-${run}`}`)).toEqual([]);
    expect(await rows(sql`SELECT id FROM control.cost_ledger WHERE idempotency_key = ${`r3-${run}`}`)).toEqual([]);
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 0 });
  });

  it.each([
    ['no_strategy', async () => {}, 'cheap'],
    ['missing_bucket', async () => { await seedStrategy(TENANT); }, 'cheap'],
    ['no_pricing', async () => { await seedTenant(); }, 'unpriced'],
  ])('fails closed as unavailable (never 429, never free) with reason %s', async (reason, seed, model) => {
    await seed();
    expect(await admit(`r4-${run}`, quote([{ model }]))).toEqual({ kind: 'unavailable' });
    expect(await rows(sql`SELECT reason FROM control.blocked_attempts WHERE request_id = ${`r4-${run}`}`)).toEqual([{ reason }]);
    expect(await rows(sql`SELECT id FROM control.budget_holds WHERE request_id = ${`r4-${run}`}`)).toEqual([]);
  });

  it('answers unavailable on a store failure', async () => {
    const broken = createBudgetAdmission({
      database: { transaction: async () => { throw new Error('ECONNREFUSED'); }, execute: db.execute.bind(db) } as never,
      ownerRef: 'test',
    });
    expect(await broken.admit({ requestId: 'x', cost: cost(), wire: 'openai-chat-completions', quote: quote([{ model: 'cheap' }]) }))
      .toEqual({ kind: 'unavailable' });
  });

  it('admits exactly one of two concurrent requests near the cap', async () => {
    await seedTenant(4_000); // one cheap request reserves 1250 + 2000 = 3250.
    const decisions = await Promise.all([admit(`r5a-${run}`, quote([{ model: 'cheap' }])), admit(`r5b-${run}`, quote([{ model: 'cheap' }]))]);
    expect(decisions.map((decision) => decision.kind).sort()).toEqual(['admitted', 'over-budget']);
    expect((await bucket(TENANT)).reserved).toBe(3_250);
  });

  it('keeps principal_key opaque: an e-mail or IP principal is refused and never stored', async () => {
    expect(principalOf({ principalId: 'service:svc-1' })).toEqual({ kind: 'service', key: 'service:svc-1' });
    for (const principalId of ['alice@example.com', '10.0.0.1', '2001:db8::1', 'has space']) {
      expect(() => principalOf({ principalId })).toThrow(PrincipalKeyError);
    }
    await seedTenant();
    expect(await admit(`r6-${run}`, quote([{ model: 'cheap' }]), cost({ principalId: 'alice@example.com' })))
      .toEqual({ kind: 'unavailable' });
    for (const table of ['budget_holds', 'blocked_attempts', 'cost_ledger']) {
      expect(await rows(sql`SELECT 1 FROM ${sql.raw(`control.${table}`)} WHERE principal_key LIKE '%@%'`)).toEqual([]);
    }
  });
});
