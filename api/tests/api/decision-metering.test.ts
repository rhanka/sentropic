import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import * as host from '@sentropic/llm-mesh/decision/host';
import * as mesh from '@sentropic/llm-mesh';
import { db } from '../../src/db/client';
import { createDecisionAuth, createDecisionHost, decisionDescriptors } from '../../src/services/decision-host';
import { createDecisionMetering } from '../../src/services/llm-metering/decision';
import { evaluatorKey } from '../../src/services/llm-metering/decision-store';
import { resolveDecisionPrice } from '../../src/services/llm-metering/decision-pricing';
import { reapExpiredHolds } from '../../src/services/llm-metering/reservation-reaper';
import { createDecisionAdmission } from '../../src/services/llm-metering/decision-admission';
import { loadPricing } from '../../src/services/llm-metering/budget-admission';
import { insertModelPricing } from '../../src/services/llm-metering/model-pricing-writer';
import { decisionRequest, jevResponse } from '../../../packages/llm-mesh/tests/decision-fixtures';

const tenant = `decision-${randomUUID().slice(0, 8)}`;
const cost = { tenantId: tenant, workspaceId: `${tenant}-workspace`, principalId: 'decision-fixture-user',
  source: 'test', correlationId: 'decision-fixture' };
const descriptors = decisionDescriptors(host, 'qualification');
const query = async <T>(statement: ReturnType<typeof sql>) => (await db.execute(statement)).rows as T[];
const seed = async (cap = 100_000) => {
  await db.execute(sql`INSERT INTO control.tenant_budget_strategy (id, tenant_id, funding_mode, key_sourcing_mode)
    VALUES (${tenant}, ${tenant}, 'tenant_pool', 'platform')`);
  await db.execute(sql`INSERT INTO control.budgets (id, tenant_id, scope_kind, scope_key, cap_micro_usd, reset_at)
    VALUES (${tenant}, ${tenant}, 'tenant', ${tenant}, ${cap}, now() + interval '1 month')`);
};
const fixture = () => {
  const metering = createDecisionMetering(db, cost, descriptors);
  const jev = { send: vi.fn(async () => ({ ok: true as const, body: { ...jevResponse(), model: 'jev-1.13.0' } })) };
  const fetch = vi.fn(async () => Response.json({ model: 'gpt-6-luna',
    answers: [{ name: 'verdict', type: 'predicate', probability: 0.25 }],
    usage: { input_tokens: 1000, output_tokens: 0, total_tokens: 1000,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  }));
  const client = createDecisionHost({ host, mesh, profile: 'qualification', descriptors, jev, fetch,
    ports: { ...metering, authorize: async () => true,
      resolveAuth: createDecisionAuth({ JEV_API_KEY: 'fixture-jev-token', OPENAI_API_KEY: 'fixture-openai-token' }) } });
  return { client, metering, jev, fetch };
};
afterEach(async () => {
  await db.execute(sql`DELETE FROM control.decision_calls WHERE tenant_id = ${tenant}`);
  await db.execute(sql`DELETE FROM control.cost_ledger WHERE tenant_id = ${tenant}`);
  await db.execute(sql`DELETE FROM control.blocked_attempts WHERE tenant_id = ${tenant}`);
  await db.execute(sql`DELETE FROM control.event_outbox WHERE tenant_id = ${tenant}`);
  await db.execute(sql`DELETE FROM control.budget_holds WHERE tenant_id = ${tenant}`);
  await db.execute(sql`DELETE FROM control.budgets WHERE tenant_id = ${tenant}`);
  await db.execute(sql`DELETE FROM control.tenant_budget_strategy WHERE tenant_id = ${tenant}`);
  await db.execute(sql`DELETE FROM control.model_pricing WHERE id = ${`${tenant}-chat`}`);
  for (const descriptor of descriptors) await db.execute(sql`DELETE FROM control.decision_evaluator_state
    WHERE evaluator_key = ${evaluatorKey(descriptor.evaluator)}`);
});

describe('Decision durable metering and authoritative pricing', () => {
  it('should keep GPT-6 Luna generation and Decisions tariffs independent at the same effective date', async () => {
    await seed();
    await insertModelPricing(db, { id: `${tenant}-chat`, providerId: 'openai', modelId: 'gpt-6-luna',
      inputMicroUsdPerMtok: 5_000_000, outputMicroUsdPerMtok: 10_000_000, effectiveFrom: new Date('2026-10-28T00:00:00Z') });
    await db.transaction(async (tx) => {
      expect(await loadPricing(tx, 'openai', 'gpt-6-luna', new Date())).toMatchObject({ id: `${tenant}-chat`, input: 5_000_000n });
      expect(await loadPricing(tx, 'openai', 'gpt-6-luna', new Date(), 'openai-decisions'))
        .toMatchObject({ id: descriptors[1].priceProtocol.revision, input: 100_000n, output: 0n });
    });
    const f = fixture();
    expect(await f.client.decide(decisionRequest({ evaluator: descriptors[1].evaluator })))
      .toMatchObject({ ok: true, receipt: { cost: { amountMicroUsd: '100' } } });
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each([0, 1])('should use the exact published pricing row for backend %i', async (index) => {
    const descriptor = descriptors[index];
    const key = { providerId: descriptor.evaluator.providerId, modelId: descriptor.wireModel,
      protocol: descriptor.protocol ?? 'jev-native', authority: descriptor.priceProtocol.authority,
      priceRevision: descriptor.priceProtocol.revision };
    expect(await resolveDecisionPrice(db, key)).toMatchObject({ ...key,
      inputMicroUsdPerMtok: index === 0 ? '42000' : '100000', outputMicroUsdPerMtok: '0' });
    for (const mutation of [{ priceRevision: 'missing-revision' }, { protocol: 'foreign' }, { authority: 'fixture:synthetic-tariff' },
      { modelId: 'foreign-model' }, { providerId: 'foreign-provider' }]) {
      expect(await resolveDecisionPrice(db, { ...key, ...mutation })).toBeNull();
    }
  });
  it.each([0, 1])('should atomically settle backend %i once and persist only metadata', async (index) => {
    await seed();
    const f = fixture();
    const settle = vi.spyOn(f.metering.budget, 'settle');
    const result = await f.client.decide(decisionRequest({ evaluator: descriptors[index].evaluator }));
    if (!result.ok) throw new Error(`Decision fixture failed: ${result.error.code} at ${result.error.phase}`);
    expect(result).toMatchObject({ ok: true, kind: 'experimental-verdict', receipt: { budget: { state: 'settled' } } });
    await f.metering.budget.settle(settle.mock.calls[0][0]);
    const rows = await query<{ cost_micro_usd: string }>(sql`SELECT cost_micro_usd FROM control.cost_ledger WHERE tenant_id = ${tenant}`);
    expect(rows).toHaveLength(1);
    expect(String(rows[0].cost_micro_usd)).toBe(index === 0 ? '42' : '100');
    const [bucket] = await query<{ spent_micro_usd: string; reserved_micro_usd: string }>(sql`
      SELECT spent_micro_usd, reserved_micro_usd FROM control.budgets WHERE id = ${tenant}`);
    expect(String(bucket.spent_micro_usd)).toBe(index === 0 ? '42' : '100');
    expect(String(bucket.reserved_micro_usd)).toBe('0');
    const receipts = await query<{ receipt: unknown }>(sql`SELECT receipt FROM control.decision_calls WHERE tenant_id = ${tenant}`);
    expect(receipts).toHaveLength(1);
    expect(JSON.stringify(receipts)).not.toMatch(/synthetic candidate|fixture-.*-token|"verdict":/);
    expect(await query(sql`SELECT id FROM control.event_outbox WHERE tenant_id = ${tenant}`)).toHaveLength(1);
  });
  it.each(['tenant', 'workspace', 'principal', 'model'])('should enforce the %s cap before provider dispatch', async (scope) => {
    await seed(scope === 'tenant' ? 1 : 100_000);
    if (scope !== 'tenant') {
      const key = scope === 'workspace' ? cost.workspaceId : scope === 'principal' ? cost.principalId : 'typesafe/jev-1.13.0';
      await db.execute(sql`INSERT INTO control.budgets
        (id, tenant_id, workspace_id, scope_kind, scope_key, cap_micro_usd, reset_at)
        VALUES (${`${tenant}-${scope}`}, ${tenant}, ${scope === 'workspace' ? cost.workspaceId : null},
          ${scope}, ${key}, 1, now() + interval '1 month')`);
    }
    const f = fixture();
    expect(await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'BUDGET_EXHAUSTED' }, receipt: { attempts: 0 } });
    expect(f.jev.send).not.toHaveBeenCalled();
    expect(await query(sql`SELECT id FROM control.budget_holds WHERE tenant_id = ${tenant}`)).toHaveLength(0);
  });
  it('should retain unknown provider usage as pending conservative spend', async () => {
    await seed();
    const f = fixture();
    f.jev.send.mockRejectedValueOnce(new Error('fixture-uncertain-provider-dispatch'));
    const result = await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator }));
    expect(result).toMatchObject({ ok: false, receipt: { budget: { state: 'pending-reconciliation' },
      cost: { amountMicroUsd: '2753', source: 'reserved-liability' }, attempts: 1 } });
    const [row] = await query<{ cost_micro_usd: string; reconciliation_state: string; input_tokens: null }>(sql`
      SELECT cost_micro_usd, reconciliation_state, input_tokens FROM control.cost_ledger WHERE tenant_id = ${tenant}`);
    expect(row).toEqual({ cost_micro_usd: '2753', reconciliation_state: 'pending', input_tokens: null });
    const [bucket] = await query<{ spent_micro_usd: string; reserved_micro_usd: string }>(sql`
      SELECT spent_micro_usd, reserved_micro_usd FROM control.budgets WHERE id = ${tenant}`);
    expect(bucket).toEqual({ spent_micro_usd: '2753', reserved_micro_usd: '0' });
  });
  it('should charge an overrun fully and disable its evaluator across host reconstruction', async () => {
    await seed();
    const f = fixture();
    f.jev.send.mockResolvedValueOnce({ ok: true, body: { ...jevResponse(), model: 'jev-1.13.0',
      usage: { input_tokens: 100_000, output_tokens: 0 } } });
    const result = await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator }));
    expect(result.receipt.budget.overrun).toBe(true);
    const [row] = await query<{ spent_micro_usd: string }>(sql`SELECT spent_micro_usd FROM control.budgets WHERE id = ${tenant}`);
    expect(String(row.spent_micro_usd)).toBe('4200');
    const restarted = fixture();
    expect(await restarted.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' }, receipt: { attempts: 0 } });
    expect(restarted.jev.send).not.toHaveBeenCalled();
    expect(await restarted.metering.probe(descriptors[0].evaluator)).toBe(false);
    expect(await restarted.metering.probe(descriptors[1].evaluator)).toBe(true);
  });
  it('should refuse readiness and admission when tenant financial authority is absent', async () => {
    const f = fixture();
    expect(await f.metering.probe()).toBe(false);
    expect(await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'BUDGET_UNAVAILABLE' }, receipt: { attempts: 0 } });
    expect(f.jev.send).not.toHaveBeenCalled();
  });
  it('should release an unsent hold when its evaluator is disabled between admission and dispatch', async () => {
    await seed();
    const f = fixture();
    const admit = f.metering.budget.admit.bind(f.metering.budget);
    vi.spyOn(f.metering.budget, 'admit').mockImplementation(async (input) => {
      const result = await admit(input);
      await db.execute(sql`UPDATE control.decision_evaluator_state SET disabled = true
        WHERE evaluator_key = ${evaluatorKey(input.evaluator)}`);
      return result;
    });
    expect(await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' }, receipt: { budget: { state: 'released' }, attempts: 0 } });
    expect(f.jev.send).not.toHaveBeenCalled();
    expect(await query(sql`SELECT id FROM control.cost_ledger WHERE tenant_id = ${tenant}`)).toHaveLength(0);
  });
  it('should retain liability when dispatch marking names a different evaluator', async () => {
    await seed();
    const f = fixture();
    const mark = f.metering.budget.markDispatched.bind(f.metering.budget);
    vi.spyOn(f.metering.budget, 'markDispatched').mockImplementation((input) => mark({ ...input, evaluator: descriptors[1].evaluator }));
    expect(await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' }, receipt: { attempts: 0,
        budget: { state: 'pending-reconciliation' } } });
    expect(f.jev.send).not.toHaveBeenCalled();
  });
  it('should reconcile a reaper charge once without replaying the provider or losing Decision attribution', async () => {
    await seed();
    const f = fixture();
    f.jev.send.mockImplementationOnce(async () => {
      expect(await reapExpiredHolds({ database: db, now: new Date(Date.now() + 60_000) }))
        .toMatchObject({ reconciled: 1, failed: 0 });
      return { ok: true, body: { ...jevResponse(), model: 'jev-1.13.0' } };
    });
    const settle = vi.spyOn(f.metering.budget, 'settle');
    const result = await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator }));
    expect(result.ok).toBe(true);
    await f.metering.budget.settle(settle.mock.calls[0][0]);
    const [ledger] = await query<{ operation: string; provider_id: string; cost_micro_usd: string; reconciliation_state: string }>(sql`
      SELECT operation, provider_id, cost_micro_usd, reconciliation_state FROM control.cost_ledger WHERE tenant_id = ${tenant}`);
    expect(ledger).toEqual({ operation: 'decision', provider_id: 'typesafe', cost_micro_usd: '42', reconciliation_state: 'reconciled' });
    const [bucket] = await query<{ spent_micro_usd: string }>(sql`SELECT spent_micro_usd FROM control.budgets WHERE id = ${tenant}`);
    expect(String(bucket.spent_micro_usd)).toBe('42');
    expect(f.jev.send).toHaveBeenCalledOnce();
  });
  it('should release an unsent hold when its pinned tariff expires before dispatch marking', async () => {
    await seed();
    const f = fixture();
    const mark = f.metering.budget.markDispatched.bind(f.metering.budget);
    vi.spyOn(f.metering.budget, 'markDispatched').mockImplementation(async (input) => {
      const id = descriptors[0].priceProtocol.revision;
      await db.execute(sql`UPDATE control.model_pricing SET effective_to = now() WHERE id = ${id}`);
      try { return await mark(input); }
      finally { await db.execute(sql`UPDATE control.model_pricing SET effective_to = NULL WHERE id = ${id}`); }
    });
    expect(await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'BUDGET_UNAVAILABLE' }, receipt: { attempts: 0, budget: { state: 'released' } } });
    expect(f.jev.send).not.toHaveBeenCalled();
  });
  it('should retain ambiguous admission liability when the hold commits but its acknowledgement is lost', async () => {
    await seed();
    const f = fixture();
    const uncertain = createDecisionAdmission({ execute: db.execute.bind(db), transaction: async (run) => {
      await db.transaction(run);
      throw new Error('Fixture lost commit acknowledgement');
    } }, cost, descriptors);
    vi.spyOn(f.metering.budget, 'admit').mockImplementation(uncertain.admit);
    expect(await f.client.decide(decisionRequest({ evaluator: descriptors[0].evaluator })))
      .toMatchObject({ ok: false, error: { code: 'BUDGET_UNAVAILABLE' }, receipt: { attempts: 0,
        budget: { state: 'pending-reconciliation' }, cost: { amountMicroUsd: '2753' } } });
    expect(await query(sql`SELECT id FROM control.budget_holds WHERE tenant_id = ${tenant}`)).toHaveLength(1);
    expect(f.jev.send).not.toHaveBeenCalled();
  });
});
