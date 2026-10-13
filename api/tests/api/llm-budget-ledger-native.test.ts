import { expect, it } from 'vitest';
import { recordLlmUsage } from '../../src/services/llm-metering';
import { sql } from 'drizzle-orm';
import { withNativeLedger } from './native-ledger-fixture';
it('joins opaque HTTP response, physical observation and exactly one priced financial row by server request ID', async () => {
  await withNativeLedger({}, async h => {
    const response = await h.router.request('/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(h.request.body) });
    expect(response.status).toBe(200); expect(response.headers.get('x-sentropic-request-id')).toBe(h.requestId);
    await Promise.all(h.writes);
    const financial = await h.financial(), observation = await h.observation();
    expect(await h.ledger()).toHaveLength(2);
    expect(financial.idempotency_key).toBe(h.requestId); expect(observation.response_id).toBe(h.requestId);
    expect(observation.idempotency_key).not.toBe(h.requestId); expect(observation.idempotency_key).not.toBe(h.cost.correlationId);
    expect(observation.cost_micro_usd).toBeNull(); expect(Number(financial.cost_micro_usd)).toBe(1490);
    expect(financial.pricing_version).toBe(h.pricingId);
    expect(await h.rows(sql`SELECT reserved_micro_usd, spent_micro_usd FROM control.budgets WHERE tenant_id = ${h.cost.tenantId}`))
      .toEqual([{ reserved_micro_usd: '0', spent_micro_usd: '1490' }]);
  });
});
it('fences duplicate financial settlement and observation replay while role readers never sum both', async () => {
  await withNativeLedger({ allowanceInput: 20_000 }, async h => {
    await h.run();
    await h.settlement.settleRoute(h.settled[0]!);
    await h.settlement.settleRoute(h.settled[0]!);
    await recordLlmUsage(h.record.mock.calls[0]![0]);
    await h.attempt.nativeMessages!.finalize!(h.snapshots[0]!);
    expect(h.record).toHaveBeenCalledOnce(); expect(await h.ledger()).toHaveLength(2);
    expect(h.cost.correlationId).not.toBe(h.requestId);
    const financial = await h.financial(), observation = await h.observation();
    expect(financial).toMatchObject({ input_tokens: 10350, output_tokens: 20 });
    expect(observation).toMatchObject({ input_tokens: 10350, output_tokens: 20, total_tokens: 10370 });
    const totals = await h.rows(sql`SELECT
      sum(input_tokens) FILTER (WHERE hold_id IS NOT NULL) AS financial_input,
      sum(input_tokens) FILTER (WHERE hold_id IS NULL) AS physical_input,
      sum(cost_micro_usd) FILTER (WHERE hold_id IS NOT NULL) AS charged
      FROM control.cost_ledger WHERE idempotency_key = ${h.requestId} OR response_id = ${h.requestId}`);
    expect(totals).toEqual([{ financial_input: '10350', physical_input: '10350', charged: '1490' }]);
    expect(await h.rows(sql`SELECT status FROM control.budget_holds WHERE request_id = ${h.requestId}`)).toEqual([{ status: 'settled' }]);
    expect(await h.rows(sql`SELECT count(*) AS n FROM control.event_outbox WHERE aggregate_id = ${h.requestId}`)).toEqual([{ n: '1' }]);
    expect(await h.audit()).toEqual([]);
  });
});
