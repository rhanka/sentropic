// Lot D B3c: application budget admission, route settlement and reservation reaper on the real
// Postgres of this ENV (0008 tables), then the product `/gw` and the standalone host over them.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { RouteMeteringSink, RouteRequestSettlement } from '@sentropic/llm-gateway';
import type { RoutePlanner, RouteQuote } from '@sentropic/llm-mesh';
import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHostApp, createLedgerDependencies, createRoutingDependency } from '../../../apps/llm-gateway/src/app';
import { db } from '../../src/db/client';
import { logger } from '../../src/logger';
import { createGwNamespaceModule, GW_AUTHOR, GW_DEFAULT_OUTPUT_TOKENS } from '../../src/routes/namespaces/gw';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  createBudgetAdmission, createRouteSettlement, insertModelPricing, principalOf, reapExpiredHolds, recordLlmUsage,
  redactSettlementAttempt, routePartitionHash, PrincipalKeyError, withCatalogQuote, type RoutePartitionConfig,
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
    for (const principalId of ['alice@example.com', '10.0.0.1', '2001:db8::1', 'has space', 'example.com']) {
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

const attempt = (model: string, input: number, output: number, extra: Record<string, unknown> = {}) => ({
  candidateRef: 'application-gateway-candidate-7', providerId: PROVIDER, modelId: model, transportProviderId: 'fixture',
  outcome: 'success', usage: { inputTokens: input, outputTokens: output, estimated: false }, ...extra,
}) as unknown as RouteRequestSettlement['attempts'][number];

const settle = (requestId: string, holdRef: string, attempts: RouteRequestSettlement['attempts'],
  extra: Partial<RouteRequestSettlement> = {}) => settlement.settleRoute({
  cost: cost(), wire: 'openai-chat-completions', requestedModel: 'cheap', outcome: 'success',
  usage: {
    inputTokens: attempts.reduce((total, entry) => total + entry.usage.inputTokens, 0),
    outputTokens: attempts.reduce((total, entry) => total + entry.usage.outputTokens, 0), estimated: false,
  },
  attempts, requestId, holdRef, quoteRef: `quote_${run}`, ...extra,
});

const admitted = async (requestId: string, q = quote([{ model: 'cheap' }]), port = admission) => {
  const decision = await port.admit({ requestId, cost: cost(), wire: 'openai-chat-completions', quote: q });
  if (decision.kind !== 'admitted') throw new Error(`expected admission, got ${decision.kind}`);
  return decision.holdRef;
};

const ledger = (requestId: string) => rows<Record<string, unknown>>(sql`SELECT * FROM control.cost_ledger
  WHERE idempotency_key = ${requestId}`);

describe('route settlement: one ledger row per settled request', () => {
  it('writes one attributed row, settles the hold and fences duplicate settlement and observer redelivery', async () => {
    await seedTenant();
    const requestId = `s1-${run}`;
    const holdRef = await admitted(requestId);
    await admission.markDispatched(holdRef, 0);
    await settle(requestId, holdRef, [attempt('cheap', 100, 50)]);
    await settle(requestId, holdRef, [attempt('cheap', 100, 50)]);
    await recordLlmUsage({ callId: requestId, operation: 'generate', providerId: PROVIDER, modelId: 'cheap' });
    const [row, ...more] = await ledger(requestId);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      tenant_id: TENANT, workspace_id: `${TENANT}-ws`, user_id: 'user-1', operation: 'generate', provider_id: PROVIDER,
      model_id: 'cheap', input_tokens: 100, output_tokens: 50, result: 'ok', hold_id: holdRef, quote_ref: `quote_${run}`,
      principal_kind: 'user', principal_key: 'user-1', budget_strategy_id: `${TENANT}-strategy`,
      pricing_version: `${PROVIDER}-cheap`, reconciliation_state: 'none',
    });
    expect(num(row!.cost_micro_usd)).toBe(200);
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 200 });
    expect(await rows(sql`SELECT status FROM control.budget_holds WHERE id = ${holdRef}`)).toEqual([{ status: 'settled' }]);
    expect(await rows(sql`SELECT envelope->>'type' AS type FROM control.event_outbox WHERE aggregate_id = ${requestId}`))
      .toEqual([{ type: 'llm.request.settled' }]);
  });

  it('prices each attempt at its own quoted pricing version (mixed prices across a fallback)', async () => {
    await seedTenant();
    const requestId = `s2-${run}`;
    const holdRef = await admitted(requestId, quote([{ model: 'cheap' }, { model: 'dear' }], 2));
    await admission.markDispatched(holdRef, 0);
    await admission.markDispatched(holdRef, 1);
    await settle(requestId, holdRef, [attempt('cheap', 10, 0, { outcome: 'provider-5xx' }), attempt('dear', 100, 50)]);
    const [row] = await ledger(requestId);
    // dear output is billed at its reasoning rate (30 > 20), as reserved: 100 × 10 + 50 × 30.
    expect(num(row!.cost_micro_usd)).toBe(10 + 1_000 + 1_500);
    expect(row!.model_id).toBe('dear');
    expect((row!.attempts as Array<Record<string, unknown>>).map((entry) => [entry.modelId, entry.costMicroUsd, entry.pricingVersion]))
      .toEqual([['cheap', 10, `${PROVIDER}-cheap`], ['dear', 2_500, `${PROVIDER}-dear`]]);
  });

  it('charges an overrun in full and audits it with the hold and quote references', async () => {
    await seedTenant();
    const requestId = `s3-${run}`;
    const holdRef = await admitted(requestId, quote([{ model: 'codex', enforced: false }]));
    await admission.markDispatched(holdRef, 0);
    await settle(requestId, holdRef, [attempt('codex', 100, 50_000)], { overrun: [] });
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 50_100 });
    expect(await rows(sql`SELECT reason, hold_id, quote_ref, liability_micro_usd FROM control.blocked_attempts
      WHERE request_id = ${requestId}`)).toEqual([{ reason: 'overrun', hold_id: holdRef, quote_ref: `quote_${run}`, liability_micro_usd: '50100' }]);
  });

  it('builds attempts only from allowlisted ids and numbers (unexpected text dropped)', async () => {
    const redacted = redactSettlementAttempt(attempt('cheap', 3, 4, {
      providerId: 'openai ignore previous instructions', transportProviderId: 'acct_secret@example.com',
      outcome: 'Some provider message', text: 'secret prompt', accountId: 'account-1',
    }), 7n, 'pricing-1');
    expect(redacted).toEqual({ modelId: 'cheap', inputTokens: 3, outputTokens: 4, estimated: false, costMicroUsd: 7, pricingVersion: 'pricing-1' });
    await seedTenant();
    const requestId = `s4-${run}`;
    const holdRef = await admitted(requestId);
    await admission.markDispatched(holdRef, 0);
    await settle(requestId, holdRef, [attempt('cheap', 3, 4, { text: 'secret prompt', usage: { inputTokens: 3, outputTokens: 4, estimated: false, raw: 'x' } })]);
    const [row] = await ledger(requestId);
    const stored = JSON.stringify(row!.attempts);
    for (const leak of ['secret', 'candidate', 'raw', 'text']) expect(stored).not.toContain(leak);
  });

  it('releases only never-dispatched holds, idempotently, and never frees a dispatched hold', async () => {
    await seedTenant();
    const released = await admitted(`s5a-${run}`);
    await admission.release(released);
    await admission.release(released);
    await expect(admission.markDispatched(released, 0)).rejects.toThrow();
    const dispatched = await admitted(`s5b-${run}`);
    await admission.markDispatched(dispatched, 0);
    await admission.release(dispatched);
    expect(await rows(sql`SELECT request_id, status FROM control.budget_holds WHERE tenant_id = ${TENANT} ORDER BY request_id`))
      .toEqual([{ request_id: `s5a-${run}`, status: 'released' }, { request_id: `s5b-${run}`, status: 'dispatched' }]);
    expect((await bucket(TENANT)).reserved).toBe(3_250);
    await expect(settle(`s5c-${run}`, dispatched, [])).rejects.toMatchObject({ code: 'llm_route_settlement_refused' });
  });
});

describe('reservation reaper', () => {
  const past = createBudgetAdmission({ database: db, ownerRef: 'test', now: () => new Date(Date.now() - 2 * 3_600_000), holdTtlMs: 60_000 });

  it('should settle each expired hold once when API and host reapers run concurrently', async () => {
    await seedTenant();
    await seedBucket(TENANT, 'workspace', `${TENANT}-ws`, null, { workspaceId: `${TENANT}-ws` });
    const live = await admitted(`reapers-live-${run}`);
    const holds: Array<{ id: string; request: string; dispatched: boolean }> = [];
    for (let index = 0; index < 6; index += 1) {
      const request = `reapers-${index}-${run}`;
      const id = await admitted(request, undefined, past);
      const dispatched = index % 2 === 0;
      if (dispatched) await past.markDispatched(id, 0);
      holds.push({ id, request, dispatched });
    }
    for (const scope of ['tenant', 'workspace']) {
      expect(await bucket(TENANT, scope)).toEqual({ reserved: 7 * 3_250, spent: 0 });
    }
    const outcomes = await Promise.all([
      reapExpiredHolds({ database: db }), reapExpiredHolds({ database: db }),
    ]);
    expect(outcomes.reduce((sum, next) => ({ released: sum.released + next.released,
      reconciled: sum.reconciled + next.reconciled, failed: sum.failed + next.failed }),
    { released: 0, reconciled: 0, failed: 0 })).toEqual({ released: 3, reconciled: 3, failed: 0 });
    for (const hold of holds) {
      expect(await rows(sql`SELECT status, settled_at IS NOT NULL AS settled FROM control.budget_holds WHERE id = ${hold.id}`))
        .toEqual([{ status: hold.dispatched ? 'reconciled' : 'released', settled: true }]);
      const entries = await ledger(hold.request);
      expect(entries).toHaveLength(hold.dispatched ? 1 : 0);
      if (hold.dispatched) {
        expect(entries[0]).toMatchObject({ hold_id: hold.id, reconciliation_state: 'pending' });
        expect(num(entries[0]!.cost_micro_usd)).toBe(3_250);
      }
    }
    await expect(reapExpiredHolds({ database: db })).resolves.toEqual({ released: 0, reconciled: 0, failed: 0 });
    expect(await rows(sql`SELECT status FROM control.budget_holds WHERE id = ${live}`)).toEqual([{ status: 'held' }]);
    for (const scope of ['tenant', 'workspace']) {
      expect(await bucket(TENANT, scope)).toEqual({ reserved: 3_250, spent: 3 * 3_250 });
    }
  });

  it('should roll back a poisoned hold and reap later holds in the same batch', async () => {
    await seedTenant();
    const poisoned = await admitted(`poison-${run}`, undefined, past);
    const later = await admitted(`later-${run}`, undefined, past);
    await past.markDispatched(poisoned, 0);
    await past.markDispatched(later, 0);
    // Force the first hold's budget UPDATE to overflow after its ledger INSERT.
    await db.execute(sql`UPDATE control.budget_holds SET liability_micro_usd = 9223372036854775807,
      deadline_at = ${new Date(0)} WHERE id = ${poisoned}`);
    await db.execute(sql`UPDATE control.budgets SET spent_micro_usd = 1 WHERE tenant_id = ${TENANT}`);
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      expect(await reapExpiredHolds({ database: db })).toEqual({ released: 0, reconciled: 1, failed: 1 });
      expect(await ledger(`poison-${run}`)).toEqual([]);
      expect(await rows(sql`SELECT status FROM control.budget_holds WHERE id = ${poisoned}`))
        .toEqual([{ status: 'dispatched' }]);
      expect(await ledger(`later-${run}`)).toMatchObject([{ hold_id: later, reconciliation_state: 'pending' }]);
      expect(await bucket(TENANT)).toEqual({ reserved: 3_250, spent: 3_251 });
      expect(logged).toHaveBeenCalledExactlyOnceWith({ failed: 1 }, 'reservation-reaper: hold transaction failed');
    } finally {
      logged.mockRestore();
    }
  });

  it('releases an expired never-dispatched hold, reconciles a dispatched one, and a late settlement corrects it once', async () => {
    await seedTenant();
    await admitted(`k1a-${run}`, undefined, past);
    const dispatched = await admitted(`k1b-${run}`, undefined, past);
    await past.markDispatched(dispatched, 0);
    expect(await reapExpiredHolds({ database: db })).toMatchObject({ released: 1, reconciled: 1 });
    expect(await reapExpiredHolds({ database: db })).toEqual({ released: 0, reconciled: 0, failed: 0 });
    const [pending] = await ledger(`k1b-${run}`);
    expect(pending).toMatchObject({ reconciliation_state: 'pending', hold_id: dispatched });
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 3_250 });
    await settle(`k1b-${run}`, dispatched, [attempt('cheap', 100, 50)]);
    await settle(`k1b-${run}`, dispatched, [attempt('cheap', 100, 50)]);
    const [corrected, ...more] = await ledger(`k1b-${run}`);
    expect(more).toEqual([]);
    expect(corrected).toMatchObject({ reconciliation_state: 'reconciled' });
    expect(num(corrected!.cost_micro_usd)).toBe(200);
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 200 });
  });

  it('processes each expired hold once under concurrent reapers', async () => {
    await seedTenant();
    for (const suffix of ['a', 'b', 'c']) await admitted(`k2${suffix}-${run}`, undefined, past);
    const results = await Promise.all([reapExpiredHolds({ database: db }), reapExpiredHolds({ database: db })]);
    expect(results.reduce((total, result) => total + result.released + result.reconciled, 0)).toBe(3);
    expect((await bucket(TENANT)).reserved).toBe(0);
  });

  it('keeps one row and the actual spend whether settlement or the reaper wins a race', async () => {
    await seedTenant();
    const holdRef = await admitted(`k3-${run}`, undefined, past);
    await past.markDispatched(holdRef, 0);
    await Promise.all([settle(`k3-${run}`, holdRef, [attempt('cheap', 100, 50)]), reapExpiredHolds({ database: db })]);
    const rowsFor = await ledger(`k3-${run}`);
    expect(rowsFor).toHaveLength(1);
    expect(num(rowsFor[0]!.cost_micro_usd)).toBe(200);
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 200 });
  });
});

describe('model pricing single writer (B0-A4)', () => {
  it('lets exactly one of two parallel overlapping writes succeed', async () => {
    const write = (id: string, from: number, to: number | null) => insertModelPricing(db, {
      id: `${PROVIDER}-${id}`, providerId: PROVIDER, modelId: 'race', inputMicroUsdPerMtok: 1, outputMicroUsdPerMtok: 1,
      effectiveFrom: new Date(Date.UTC(2026, 9, from)), effectiveTo: to === null ? null : new Date(Date.UTC(2026, 9, to)),
    });
    const outcomes = await Promise.allSettled([write('wa', 1, 20), write('wb', 10, null)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: { code: 'model_pricing_overlap' } });
    expect(await rows(sql`SELECT id FROM control.model_pricing WHERE provider_id = ${PROVIDER} AND model_id = 'race'`)).toHaveLength(1);
  });
});

describe('fix round 1: lock order, codex quote, workspace caps, collisions', () => {
  it('never deadlocks when admissions, settlements and releases hit the same multi-bucket set concurrently', async () => {
    await seedStrategy(TENANT);
    // Physical insertion order is the reverse of id order, so an unordered UPDATE locks backwards.
    await seedBucket(TENANT, 'workspace', `${TENANT}-ws`, null, { workspaceId: `${TENANT}-ws` });
    await seedBucket(TENANT, 'tenant', TENANT, null);
    await seedBucket(TENANT, 'model', `${PROVIDER}/cheap`, null);
    let settledCost = 0;
    for (let round = 0; round < 8; round += 1) {
      const held = await Promise.all([0, 1, 2, 3].map((index) => admitted(`d${round}-${index}-${run}`)));
      await Promise.all(held.slice(0, 2).map((holdRef) => admission.markDispatched(holdRef, 0)));
      const outcomes = await Promise.allSettled([
        ...held.slice(0, 2).map((holdRef, index) => settle(`d${round}-${index}-${run}`, holdRef, [attempt('cheap', 100, 50)])),
        ...held.slice(2).map((holdRef) => admission.release(holdRef)),
        ...[4, 5, 6].map((index) => admit(`d${round}-${index}-${run}`, quote([{ model: 'cheap' }]))),
      ]);
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(failures).toEqual([]);
      const admissions = outcomes.slice(4).map((outcome) => (outcome as PromiseFulfilledResult<{ kind: string }>).value.kind);
      expect(admissions).toEqual(['admitted', 'admitted', 'admitted']);
      settledCost += 2 * 200;
    }
    for (const scope of ['tenant', 'workspace', 'model']) {
      expect(await bucket(TENANT, scope)).toEqual({ reserved: 8 * 3 * 3_250, spent: settledCost });
    }
  }, 30_000);

  it('reserves a codex-capable catalog model (provider openai) at the model maximum output', async () => {
    const model = `llmbl-${run}-codex`;
    await insertModelPricing(db, { id: `${PROVIDER}-openai-codex`, providerId: 'openai', modelId: model,
      inputMicroUsdPerMtok: 1_000_000, outputMicroUsdPerMtok: 1_000_000, effectiveFrom: new Date(Date.now() - DAY) });
    try {
      await seedTenant();
      const planner = withCatalogQuote({} as RoutePlanner, {
        catalog: { listModels: () => [{ modelId: model, providerId: 'openai' }] }, councilRevision: 'test',
      });
      const codexQuote = planner.quote!({ requestedModel: model, ceiling: { inputTokens: 1_000, outputTokens: 100 }, now: new Date() });
      expect(codexQuote.candidates[0]!.outputCeilingEnforced).toBe(false);
      expect(await admit(`c1-${run}`, codexQuote)).toMatchObject({ kind: 'admitted' });
      expect((await bucket(TENANT)).reserved).toBe(1_250 + 10_000);
    } finally {
      await db.execute(sql`DELETE FROM control.model_pricing WHERE id = ${`${PROVIDER}-openai-codex`}`);
    }
  });

  it('refuses a workspace-less caller as missing_bucket when a workspace cap exists', async () => {
    await seedTenant();
    await seedBucket(TENANT, 'workspace', `${TENANT}-ws`, 1, { workspaceId: `${TENANT}-ws` });
    expect(await admit(`w1-${run}`, quote([{ model: 'cheap' }]), { ...cost(), workspaceId: undefined } as never))
      .toEqual({ kind: 'unavailable' });
    expect(await rows(sql`SELECT reason FROM control.blocked_attempts WHERE request_id = ${`w1-${run}`}`))
      .toEqual([{ reason: 'missing_bucket' }]);
  });

  it('audits an overrun found by a late settlement correcting the reaper estimate', async () => {
    await seedTenant();
    const past = createBudgetAdmission({ database: db, ownerRef: 'test', now: () => new Date(Date.now() - 7_200_000), holdTtlMs: 60_000 });
    const holdRef = await admitted(`o1-${run}`, undefined, past);
    await past.markDispatched(holdRef, 0);
    await reapExpiredHolds({ database: db });
    await settle(`o1-${run}`, holdRef, [attempt('cheap', 100, 5_000)]);
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 10_100 });
    expect(await rows(sql`SELECT reason, hold_id FROM control.blocked_attempts WHERE request_id = ${`o1-${run}`}`))
      .toEqual([{ reason: 'overrun', hold_id: holdRef }]);
  });

  it('adopts a hold-less observation row keyed by the request id, and still charges on a foreign-hold collision', async () => {
    await seedTenant();
    const adopted = await admitted(`x1-${run}`);
    await admission.markDispatched(adopted, 0);
    await recordLlmUsage({ callId: `x1-${run}`, operation: 'generate', providerId: PROVIDER, modelId: 'cheap' });
    await settle(`x1-${run}`, adopted, [attempt('cheap', 100, 50)]);
    const [row, ...more] = await ledger(`x1-${run}`);
    expect(more).toEqual([]);
    expect(row).toMatchObject({ hold_id: adopted, tenant_id: TENANT, principal_key: 'user-1', result: 'ok' });
    expect(num(row!.cost_micro_usd)).toBe(200);

    const colliding = await admitted(`x2-${run}`);
    await admission.markDispatched(colliding, 0);
    await db.execute(sql`INSERT INTO control.cost_ledger (id, idempotency_key, tenant_id, operation, provider_id, model_id, hold_id)
      VALUES (${`x2-${run}`}, ${`x2-${run}`}, ${TENANT}, 'generate', 'p', 'm', 'another-hold')`);
    await settle(`x2-${run}`, colliding, [attempt('cheap', 100, 50)]);
    // Redelivery must preserve the foreign row and must not add this hold's spend again.
    await settle(`x2-${run}`, colliding, [attempt('cheap', 100, 50)]);
    expect(await rows(sql`SELECT status FROM control.budget_holds WHERE id = ${colliding}`)).toEqual([{ status: 'settled' }]);
    expect(await ledger(`x2-${run}`)).toMatchObject([{ hold_id: 'another-hold', cost_micro_usd: null }]);
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 400 });
  });

  it('should retain the reaper charge when a foreign ledger row cannot fence a late correction', async () => {
    await seedTenant();
    // Use current pricing at admission, then expire the dispatched hold.
    const holdRef = await admitted(`foreign-late-${run}`);
    await admission.markDispatched(holdRef, 0);
    await db.execute(sql`UPDATE control.budget_holds SET deadline_at = ${new Date(0)} WHERE id = ${holdRef}`);
    await db.execute(sql`INSERT INTO control.cost_ledger (id, idempotency_key, tenant_id, operation, provider_id, model_id, hold_id)
      VALUES (${`foreign-late-${run}`}, ${`foreign-late-${run}`}, ${TENANT}, 'generate', 'p', 'm', 'another-hold')`);
    await reapExpiredHolds({ database: db });
    await settle(`foreign-late-${run}`, holdRef, [attempt('cheap', 100, 50)]);
    await settle(`foreign-late-${run}`, holdRef, [attempt('cheap', 100, 50)]);
    expect(await bucket(TENANT)).toEqual({ reserved: 0, spent: 3_250 });
    expect(await ledger(`foreign-late-${run}`)).toMatchObject([{ hold_id: 'another-hold', cost_micro_usd: null }]);
  });
});

// --- Product `/api/v1/gw` and the standalone host over the same ledger adapters. ---
const P_TENANT = `llmbp-${run}`;
const P_MODEL = { providerId: 'openai', modelId: 'gpt-5.6-terra' };
const cutovers = new PostgresClusterMeshCutoverStore();
const CUTOVER_KEY = { compositionRoot: 'product' as const, namespace: '/gw' as const };
const partitionOf = (tenants: RoutePartitionConfig['tenants']): RoutePartitionConfig =>
  ({ revision: `p-${run}`, hash: routePartitionHash(`p-${run}`, tenants), tenants });
const productPartition = partitionOf({ [P_TENANT]: { product: ['user-p'], standalone: ['host-user'] } });
const sourceOf = (config: RoutePartitionConfig) => ({ load: () => config, expected: () => ({ revision: config.revision, hash: config.hash }) });
const clearCutover = () => db.execute(sql`DELETE FROM control.cluster_mesh_namespace_cutovers
  WHERE composition_root = 'product' AND namespace = '/gw'`);

const productApp = async (options: {
  generate?: ReturnType<typeof vi.fn>; stream?: ReturnType<typeof vi.fn>;
  partition?: RoutePartitionConfig; settlement?: RouteMeteringSink;
} = {}) => {
  const generate = options.generate ?? vi.fn().mockResolvedValue({
    id: 'r', providerId: 'openai', modelId: P_MODEL.modelId, message: { role: 'assistant', content: 'ok' }, text: 'ok',
    toolCalls: [], finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 1 },
  });
  const stream = options.stream ?? vi.fn(async () => (async function* () {
    yield { type: 'content_delta', data: { delta: 'ok' } };
    yield { type: 'done', data: { finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 1 } } };
  })());
  const module = await createGwNamespaceModule({
    routePlane: createApplicationGatewayRoutePlane({ dispatch: { generate, stream } }),
    authenticate: async (_context, next) => next(),
    resolveCaller: () => ({
      tenantId: P_TENANT, workspaceId: `${P_TENANT}-ws`, principalId: 'user-p', source: 'test',
      ownerScopeRef: `workspace:${P_TENANT}-ws:principal:user-p`, correlationId: randomUUID(), callSite: '/api/v1/gw',
    }),
    partition: sourceOf(options.partition ?? productPartition),
    ...(options.settlement ? { settlement: options.settlement } : {}),
  });
  const app = new Hono().route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime, namespaces: [module],
  }));
  return { app, generate, stream };
};

const openai = (stream: boolean) => ({
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: P_MODEL.modelId, stream, messages: [{ role: 'user', content: 'hello' }] }),
});
const anthropic = (stream: boolean) => ({
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: P_MODEL.modelId, stream, max_tokens: 64, messages: [{ role: 'user', content: 'hello' }] }),
});
const tenantLedger = () => rows<Record<string, unknown>>(sql`SELECT * FROM control.cost_ledger WHERE tenant_id = ${P_TENANT}`);

describe('product /api/v1/gw over the ledger', () => {
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM control.model_pricing WHERE provider_id = ${P_MODEL.providerId} AND model_id = ${P_MODEL.modelId}`);
    await insertModelPricing(db, { id: `llmbp-${run}-price`, ...P_MODEL, inputMicroUsdPerMtok: 1_000_000,
      outputMicroUsdPerMtok: 2_000_000, effectiveFrom: new Date(Date.now() - DAY) });
    await insertModelPricing(db, { id: `llmbp-${run}-host`, providerId: PROVIDER, modelId: 'host-model',
      inputMicroUsdPerMtok: 1_000_000, outputMicroUsdPerMtok: 1_000_000, effectiveFrom: new Date(Date.now() - DAY) });
    await clearCutover();
    await cutovers.activate({
      ...CUTOVER_KEY, selectedGenerationId: clusterMeshAdapter.sessionControl!.runtime.generation.generationId,
      previousGenerationId: 'application-llm-adapter-v1', activeAuthor: GW_AUTHOR, status: 'active',
      shadowComparison: { strategy: 'operator-activation', partition: { revision: productPartition.revision, hash: productPartition.hash } },
      rollbackCheckpoint: { generationId: 'application-llm-adapter-v1', activeAuthor: 'application-llm-adapter' },
    });
  });
  afterAll(async () => {
    await clearCutover();
    await db.execute(sql`DELETE FROM control.model_pricing WHERE id IN (${`llmbp-${run}-price`}, ${`llmbp-${run}-host`})`);
  });
  afterEach(() => cleanTenant(P_TENANT));

  const seedProduct = async (cap: number) => {
    await seedStrategy(P_TENANT);
    await seedBucket(P_TENANT, 'tenant', P_TENANT, cap);
  };

  it.each([
    ['openai JSON', 'chat/completions', openai(false)], ['openai SSE', 'chat/completions', openai(true)],
    ['anthropic JSON', 'messages', anthropic(false)], ['anthropic SSE', 'messages', anthropic(true)],
  ])('returns the real 429 before any acquisition on %s, with zero cost rows', async (_name, path, init) => {
    await seedProduct(100);
    const { app, generate, stream } = await productApp();
    const response = await app.request(`/api/v1/gw/v1/${path}`, init);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(generate).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(await tenantLedger()).toEqual([]);
    expect(await rows(sql`SELECT reason FROM control.blocked_attempts WHERE tenant_id = ${P_TENANT}`)).toEqual([{ reason: 'cap' }]);
  });

  it.each([[false, 'generate'], [true, 'stream']])('settles one priced row per request (stream=%s)', async (streamed, operation) => {
    await seedProduct(1_000_000);
    const { app } = await productApp();
    const response = await app.request('/api/v1/gw/v1/chat/completions', openai(streamed));
    expect(response.status).toBe(200);
    await response.text();
    const [row, ...more] = await tenantLedger();
    expect(more).toEqual([]);
    expect(row).toMatchObject({ operation, result: 'ok', provider_id: 'openai', model_id: P_MODEL.modelId,
      principal_key: 'user-p', pricing_version: `llmbp-${run}-price`, reconciliation_state: 'none' });
    expect(num(row!.cost_micro_usd)).toBe(4);
    expect(await bucket(P_TENANT)).toEqual({ reserved: 0, spent: 4 });
  });

  it('charges the quoted allowance when the provider reports no usage', async () => {
    await seedProduct(1_000_000);
    const generate = vi.fn().mockResolvedValue({ id: 'r', providerId: 'openai', modelId: P_MODEL.modelId,
      message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop' });
    const { app } = await productApp({ generate });
    expect((await app.request('/api/v1/gw/v1/chat/completions', openai(false))).status).toBe(200);
    const [row] = await tenantLedger();
    expect(row!.reconciliation_state).toBe('estimated');
    expect(num(row!.cost_micro_usd)).toBeGreaterThanOrEqual(GW_DEFAULT_OUTPUT_TOKENS * 2);
  });

  it('never repeats dispatch when settlement storage fails after generation', async () => {
    await seedProduct(1_000_000);
    const { app, generate } = await productApp({ settlement: { settleRoute: async () => { throw new Error('ledger down'); } } });
    await app.request('/api/v1/gw/v1/chat/completions', openai(false));
    expect(generate).toHaveBeenCalledOnce();
    expect(await tenantLedger()).toEqual([]);
  });

  it('settles an aborted stream once as aborted', async () => {
    await seedProduct(1_000_000);
    const stream = vi.fn(async (_subject: unknown, _workspace: unknown, _target: unknown, request: { signal?: AbortSignal }) =>
      (async function* () {
        yield { type: 'content_delta', data: { delta: 'one' } };
        await new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      })());
    const { app } = await productApp({ stream });
    const response = await app.request('/api/v1/gw/v1/chat/completions', openai(true));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(async () => expect(await tenantLedger()).toHaveLength(1), { timeout: 2_000 });
    expect((await tenantLedger())[0]).toMatchObject({ result: 'aborted', operation: 'stream' });
  });

  it('refuses an identity assigned to the standalone host (401, models too) and a tampered revision (503), before any budget effect', async () => {
    await seedProduct(1_000_000);
    const { app, generate } = await productApp({ partition: partitionOf({ [P_TENANT]: { standalone: ['user-p'] } }) });
    expect((await app.request('/api/v1/gw/v1/chat/completions', openai(false))).status).toBe(401);
    expect((await app.request('/api/v1/gw/v1/models')).status).toBe(401);
    const pinned = await productApp({ partition: { ...productPartition, tenants: { [P_TENANT]: { standalone: ['user-p'] } } } });
    expect((await pinned.app.request('/api/v1/gw/v1/chat/completions', openai(false))).status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
    expect(await rows(sql`SELECT id FROM control.budget_holds WHERE tenant_id = ${P_TENANT}`)).toEqual([]);
  });

  it('writes one ledger row per settled request from the standalone host too', async () => {
    await seedProduct(1_000_000);
    const ledgerDeps = createLedgerDependencies({ database: db, ownerRef: 'host-test', defaultOutputTokens: 256 });
    const host = await createHostApp({
      config: { mode: 'test', port: 0, host: '127.0.0.1', drainTimeoutMs: 1_000 },
      dependencies: {
        identity: { ready: async () => true, callerAuth: { async verify(_headers, context) {
          return { ok: true, cost: { tenantId: P_TENANT, workspaceId: `${P_TENANT}-ws`, principalId: 'host-user',
            ownerScopeRef: `workspace:${P_TENANT}-ws:principal:host-user`, source: 'host', correlationId: context.requestId } };
        } } },
        routing: createRoutingDependency({
          councilRevision: 'host-v1', ready: async () => true,
          targets: { resolve: async (_subject, requestedModel) => ({ requestedModel, providerId: PROVIDER, modelId: requestedModel,
            transportProviderId: 'fixture', reason: 'exact' }) },
          catalog: { listModels: () => [{ modelId: 'host-model', providerId: PROVIDER }] },
          dispatch: { generate: vi.fn().mockResolvedValue({ id: 'h', providerId: PROVIDER, modelId: 'host-model',
            message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [], finishReason: 'stop',
            usage: { inputTokens: 3, outputTokens: 2 } }), stream: vi.fn() },
        }),
        ...ledgerDeps,
        partition: { source: sourceOf(productPartition) },
      },
    });
    expect((await host.app.request('/readyz')).status).toBe(200);
    const response = await host.app.request('/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'host-model', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(response.status).toBe(200);
    const [row, ...more] = await tenantLedger();
    expect(more).toEqual([]);
    expect(row).toMatchObject({ principal_key: 'host-user', result: 'ok', model_id: 'host-model' });
    expect(num(row!.cost_micro_usd)).toBe(5);
  });
});
