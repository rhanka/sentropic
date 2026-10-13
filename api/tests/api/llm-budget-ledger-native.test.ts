import { expect, it } from 'vitest';
import { recordLlmUsage } from '../../src/services/llm-metering';
import { sql } from 'drizzle-orm';
import { withNativeLedger, MODELS, mixed, nativeStart, nativeFrame } from './native-ledger-fixture';
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
it.each(MODELS.flatMap((model, index) => ['cancel', 'eof'].map(terminal => [model, index, terminal] as const)))
('preserves validated mixed-cache input and floors only interrupted output: %s %s %s', async (model, index, terminal) => {
  await withNativeLedger({ model, chunks: [nativeStart(model, { ...mixed, output_tokens: 1 })],
    allowanceInput: 20000, allowanceOutput: 16 }, async h => {
    await h.run(true, terminal === 'cancel' ? 'cancel' : undefined);
    const row = await h.financial(), obs = await h.observation();
    expect(Number(row.cost_micro_usd)).toBe(index === 2 ? 732 : 1482);
    expect(row).toMatchObject({ input_tokens: 10350, output_tokens: 16 });
    expect(row.attempts[0]).toMatchObject({ estimated: true, nativeInputUsageValidated: true });
    expect(obs).toMatchObject({ input_tokens: 10350, output_tokens: 1, total_tokens: 10351 });
    expect(obs.usage_raw.final_output_observed).toBe(false); expect(h.close).toHaveBeenCalledOnce();
    expect(h.settled).toHaveLength(1); expect(h.snapshots).toHaveLength(1);
  });
});
it.each(MODELS.map((model, index) => [model, index === 2 ? 3832 : 15082] as const))
('keeps cache-heavy input proof under interruption for %s', async (model, expected) => {
  await withNativeLedger({ model, allowanceInput: 200000, allowanceOutput: 16, chunks: [nativeStart(model, {
    input_tokens: 50, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0, output_tokens: 1 })] }, async h => {
    await h.run(true); expect(Number((await h.financial()).cost_micro_usd)).toBe(expected);
    expect((await h.financial()).input_tokens).toBe(150050); expect((await h.observation()).output_tokens).toBe(1);
  });
});
it.each([['valid', 34], ['missing', 132], ['pre-fetch', 132]])('charges %s proof at exact small allowances (%s)', async (kind, expected) => {
  const usage = { ...(kind === 'missing' ? {} : { input_tokens: 2 }), cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0, output_tokens: 1 };
  await withNativeLedger({ allowanceInput: 100, allowanceOutput: 16, preFetchFailure: kind === 'pre-fetch',
    chunks: [nativeStart(MODELS[0]!, usage)] }, async h => {
    await h.run(kind !== 'pre-fetch');
    const row = await h.financial(); expect(Number(row.cost_micro_usd)).toBe(expected);
    expect(row.output_tokens).toBe(16); expect(row.attempts[0].estimated).toBe(true);
    if (kind === 'pre-fetch') { expect(h.record).not.toHaveBeenCalled(); expect(await h.ledger()).toHaveLength(1); }
    else expect((await h.observation()).output_tokens).toBe(1);
  });
});
it('keeps a larger provisional output lower bound without claiming final output', async () => {
  await withNativeLedger({ allowanceInput: 100, allowanceOutput: 16, chunks: [nativeStart(MODELS[0]!, {
    input_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 20 })] }, async h => {
    await h.run(true); expect(Number((await h.financial()).cost_micro_usd)).toBe(42);
    expect((await h.observation()).usage_raw.final_output_observed).toBe(false);
  });
});
const cacheCases = [
  ['mixed', mixed, [1490, 1490, 740]],
  ['five-minute', { ...mixed, cache_creation_input_tokens: 200,
    cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } }, [1390, 1390, 640]],
  ['one-hour', { ...mixed, cache_creation_input_tokens: 200,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 } }, [1540, 1540, 790]],
  ['read-only', { ...mixed, input_tokens: 50, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }, [15090, 15090, 3840]],
  ['default-inferred', { ...mixed, cache_creation: undefined }, [1453, 1453, 703]],
] as const;
it.each(MODELS.flatMap((model, index) => cacheCases.map(([name, usage, amounts]) => [model, name, usage, amounts[index]] as const)))
('prices %s %s with sourced ratios at pinned rates', async (model, _name, usage, expected) => {
  await withNativeLedger({ model, usage, allowanceInput: 200000 }, async h => {
    await h.run();
    const row = await h.financial(), obs = await h.observation();
    expect(Number(row.cost_micro_usd)).toBe(expected); expect(row.pricing_version).toBe(h.pricingId);
    expect(row.attempts[0].estimated).toBe(false); expect(obs.usage_raw.estimated).toBe(false);
    expect(obs.usage_raw.input_tokens).toBe(usage.input_tokens);
    expect(obs.input_tokens).toBe(usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens);
    expect(obs.output_tokens).toBe(20); expect(await h.audit()).toEqual([]);
  });
});
it.each(MODELS)('does not discount unknown one-hour split for %s', async model => {
  await withNativeLedger({ model, usage: { ...mixed, cache_creation: undefined }, allowanceInput: 10350,
    requestBody: { messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '1h' } }] }] } }, async h => {
    await h.run();
    const row = await h.financial(), obs = await h.observation();
    expect(Number(row.cost_micro_usd)).toBe(74350); expect(row.attempts[0].estimated).toBe(true);
    expect(obs.input_tokens).toBe(10350); expect(obs.usage_raw.uncertainty_reason).toBe('cache_write_split_unknown');
    expect(obs.usage_raw.cache_creation).toBeUndefined();
  });
});
it('rounds money once after rational input multiplication, never each write token', async () => {
  await withNativeLedger({ usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 2,
    cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 0 }, output_tokens: 1 } }, async h => {
    await h.run(); expect(Number((await h.financial()).cost_micro_usd)).toBe(5);
    expect((await h.observation()).input_tokens).toBe(2);
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
