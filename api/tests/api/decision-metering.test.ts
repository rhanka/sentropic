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
  for (const descriptor of descriptors) await db.execute(sql`DELETE FROM control.decision_evaluator_state
    WHERE evaluator_key = ${evaluatorKey(descriptor.evaluator)}`);
});

describe('Decision durable metering and authoritative pricing', () => {
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
});
