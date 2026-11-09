// Lot 5 (owner D3, Gemini only): metered paid-fallback metering. A settled
// request that went out on the `gemini-apikey` static-key transport emits one
// `llm.fallback.first_use` outbox event per tenant per month with
// spend-to-date and the monthly cap (projected maximum exposure), and an
// exhausted monthly budget refuses the fallback quote as over-budget with no
// provider call. Runs on the real Postgres of this ENV (0008 tables).
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { RouteRequestSettlement } from '@sentropic/llm-gateway';
import type { RouteQuote } from '@sentropic/llm-mesh';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import {
  createBudgetAdmission, createRouteSettlement, insertModelPricing,
} from '../../src/services/llm-metering';

const run = randomUUID().replace(/-/g, '').slice(0, 10);
const TENANT = `llmfb-${run}`;
const PROVIDER = 'gemini';
const MODEL = 'gemini-3.8-flash';
const FALLBACK_TRANSPORT = 'gemini-apikey';
const PRICING_ID = `llmfb-pricing-${run}`;
const DAY = 86_400_000;
const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(query)).rows as T[];

const seedStrategy = () => db.execute(sql`INSERT INTO control.tenant_budget_strategy
  (id, tenant_id, funding_mode, key_sourcing_mode) VALUES (${`${TENANT}-strategy`}, ${TENANT}, 'tenant_pool', 'platform')`);

const seedBucket = (cap: number | null) => db.execute(sql`INSERT INTO control.budgets
  (id, tenant_id, workspace_id, scope_kind, scope_key, cap_micro_usd, reset_at)
  VALUES (${`${TENANT}-tenant`}, ${TENANT}, NULL, 'tenant', ${TENANT},
    ${cap}, ${new Date(Date.now() + 20 * DAY)})`);

const cleanTenant = async () => {
  await db.execute(sql`DELETE FROM control.cost_ledger WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM control.blocked_attempts WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM control.event_outbox WHERE tenant_id = ${TENANT} AND aggregate_type IN ('llm_request', 'llm_fallback')`);
  await db.execute(sql`DELETE FROM control.budget_holds WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM control.budgets WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM control.tenant_budget_strategy WHERE tenant_id = ${TENANT}`);
};

const cost = () => ({
  tenantId: TENANT, workspaceId: `${TENANT}-ws`, principalId: 'user-1',
  ownerScopeRef: `workspace:${TENANT}-ws:principal:user-1`, source: 'test', correlationId: 'c', callSite: 'test',
});

const quote = (): RouteQuote => ({
  quoteRef: `quote_${run}`, requestedModel: MODEL, maxAttempts: 1, quotedAt: new Date().toISOString(),
  policyRevision: 'default', councilRevision: 'test',
  candidates: [{
    providerId: PROVIDER, modelId: MODEL, reason: 'exact' as const,
    allowance: { inputTokens: 1_000, outputTokens: 1_000 }, outputCeilingEnforced: true,
  }],
});

const admission = createBudgetAdmission({ database: db, ownerRef: 'test', maxOutputTokensFor: () => 10_000 });
const settlement = createRouteSettlement({ database: db });

const attempt = (transport: string, input: number, output: number) => ({
  candidateRef: 'application-gateway-candidate-7', providerId: PROVIDER, modelId: MODEL,
  transportProviderId: transport, outcome: 'success',
  usage: { inputTokens: input, outputTokens: output, estimated: false },
}) as unknown as RouteRequestSettlement['attempts'][number];

const settleRequest = async (requestId: string, transport: string) => {
  const decision = await admission.admit({ requestId, cost: cost(), wire: 'openai-chat-completions', quote: quote() });
  if (decision.kind !== 'admitted') throw new Error(`Expected admitted, got ${decision.kind}`);
  const tries = attempt(transport, 1_500, 300);
  await settlement.settleRoute({
    cost: cost(), wire: 'openai-chat-completions', requestedModel: MODEL, outcome: 'success',
    usage: { inputTokens: 1_500, outputTokens: 300, estimated: false },
    attempts: [tries], requestId, holdRef: decision.holdRef, quoteRef: `quote_${run}`,
  });
};

const fallbackEvents = () => rows<Record<string, unknown>>(sql`SELECT aggregate_id, envelope
  FROM control.event_outbox WHERE tenant_id = ${TENANT} AND aggregate_type = 'llm_fallback' ORDER BY aggregate_id`);

beforeAll(async () => {
  // Gemini flash-class rates in micro-USD per Mtok (pinned at GO per plan Lot 5).
  await insertModelPricing(db, {
    id: PRICING_ID, providerId: PROVIDER, modelId: MODEL,
    inputMicroUsdPerMtok: 300_000, outputMicroUsdPerMtok: 2_500_000,
    reasoningMicroUsdPerMtok: null, effectiveFrom: new Date(Date.now() - DAY),
  });
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM control.model_pricing WHERE id = ${PRICING_ID}`);
});

afterEach(cleanTenant);

describe('Lot 5 paid-fallback metering (owner D3)', () => {
  it('emits one first_use event with spend-to-date and monthly cap on the first fallback settlement', async () => {
    await seedStrategy();
    await seedBucket(10_000_000);
    await settleRequest(`fb1-${run}`, FALLBACK_TRANSPORT);

    const events = await fallbackEvents();
    expect(events).toHaveLength(1);
    const envelope = events[0]!.envelope as Record<string, unknown>;
    expect(envelope).toMatchObject({
      type: 'llm.fallback.first_use',
      requestId: `fb1-${run}`,
      transportProviderId: FALLBACK_TRANSPORT,
      modelId: MODEL,
      // 1500 in × 0.30 + 300 out × 2.50 micro-USD = 450 + 750.
      spendMicroUsd: 1_200,
      capMicroUsd: 10_000_000,
      projectedMaxMicroUsd: 10_000_000,
    });
    expect(typeof envelope.periodStart).toBe('string');
    expect(events[0]!.aggregate_id).toContain(TENANT);
    expect(events[0]!.aggregate_id).toContain(FALLBACK_TRANSPORT);
  });

  it('emits no second event for later fallback settlements in the same month', async () => {
    await seedStrategy();
    await seedBucket(10_000_000);
    await settleRequest(`fb2a-${run}`, FALLBACK_TRANSPORT);
    await settleRequest(`fb2b-${run}`, FALLBACK_TRANSPORT);

    const events = await fallbackEvents();
    expect(events).toHaveLength(1);
    expect((events[0]!.envelope as Record<string, unknown>).requestId).toBe(`fb2a-${run}`);
  });

  it('emits nothing when only subscription transports serve the request', async () => {
    await seedStrategy();
    await seedBucket(10_000_000);
    await settleRequest(`fb3-${run}`, 'cloud-code');

    expect(await fallbackEvents()).toEqual([]);
  });

  it('refuses the fallback quote as over-budget with no hold, ledger or provider call on an exhausted cap', async () => {
    await seedStrategy();
    await seedBucket(100);
    const decision = await admission.admit({
      requestId: `fb4-${run}`, cost: cost(), wire: 'openai-chat-completions', quote: quote(),
    });
    expect(decision.kind).toBe('over-budget');
    expect(await rows(sql`SELECT id FROM control.budget_holds WHERE request_id = ${`fb4-${run}`}`)).toEqual([]);
    expect(await rows(sql`SELECT id FROM control.cost_ledger WHERE idempotency_key = ${`fb4-${run}`}`)).toEqual([]);
    expect(await fallbackEvents()).toEqual([]);
  });
});
