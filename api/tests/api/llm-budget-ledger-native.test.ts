import { afterEach, expect, it, vi } from 'vitest';
import { NativeUsageObserver } from '@sentropic/llm-gateway';
import { recordLlmUsage } from '../../src/services/llm-metering';
import { sql } from 'drizzle-orm';
import { withNativeLedger, MODELS, mixed, nativeStart, nativeFrame } from './native-ledger-fixture';
afterEach(() => vi.restoreAllMocks());
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
const iterationCases = [undefined, null, [], [{}], {}, 'fixture-value', 1, true];
it.each(MODELS.flatMap((model, index) => iterationCases.flatMap((iterations, kind) => [false, true].map(stream =>
  [model, index, iterations, kind, stream] as const))))('applies K4 iterations policy (%s #%s %s #%s stream=%s)', async (model, index, iterations, kind, stream) => {
  const usage = { ...mixed, output_tokens: 500, ...(kind === 0 ? {} : { iterations }) };
  await withNativeLedger({ model, usage, chunks: [nativeStart(model, usage),
    nativeFrame('message_delta', { usage: { output_tokens: 500 } }), nativeFrame('message_stop')],
    allowanceInput: 10350, allowanceOutput: 32000 }, async h => {
    await h.run(stream);
    const row = await h.financial(), obs = await h.observation(), latch = kind >= 3;
    expect(Number(row.cost_micro_usd)).toBe(latch ? 74350 : index === 2 ? 1700 : 2450);
    expect(row.output_tokens).toBe(latch ? 32000 : 500); expect(row.attempts[0].estimated).toBe(latch);
    expect(obs.output_tokens).toBe(500); expect(obs.usage_raw.iterations_present).toBe(latch);
    expect(obs.usage_raw.iterations).toBeUndefined(); expect(await h.audit()).toHaveLength(latch ? 1 : 0);
    if (latch) expect(row.output_tokens / obs.output_tokens).toBe(64);
  });
});
it.each(['mismatch', 'fallback'].flatMap(kind => [false, true].map(stream => [kind, stream] as const)))
('pins realistic 64× output floor for %s (stream=%s)', async (kind, stream) => {
  const model = MODELS[0]!, served = kind === 'mismatch' ? MODELS[1]! : model;
  const usage = { ...mixed, output_tokens: 500 };
  const fallback = { type: 'fallback', token: 'fixture-private' };
  await withNativeLedger({ served, usage, body: kind === 'fallback' ? { content: [fallback] } : {},
    chunks: [nativeStart(served, usage), ...(kind === 'fallback' ? [nativeFrame('content_block_start', { content_block: fallback })] : []),
      nativeFrame('message_stop')], allowanceInput: 10350, allowanceOutput: 32000 }, async h => {
    await h.run(stream); expect(Number((await h.financial()).cost_micro_usd)).toBe(74350);
    expect((await h.financial()).output_tokens).toBe(32000); expect((await h.observation()).output_tokens).toBe(500);
    expect(await h.audit()).toHaveLength(1);
  });
});
it.each(['cancel', 'commit-failure'] as const)('hands one immutable terminal snapshot to DB observation and settlement on %s', async terminal => {
  const snapshotSpy = vi.spyOn(NativeUsageObserver.prototype, 'snapshot');
  await withNativeLedger({ allowanceInput: 20000, allowanceOutput: 32000,
    chunks: [nativeStart(MODELS[0]!, { ...mixed, output_tokens: 500 }), nativeFrame('message_stop')] }, async h => {
    await h.run(true, terminal);
    const snapshot = h.snapshots[0]!, obs = await h.observation(), row = await h.financial();
    expect(snapshotSpy).toHaveBeenCalledOnce(); expect(snapshotSpy.mock.results[0]!.value).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.rawUsage)).toBe(true);
    expect(h.record).toHaveBeenCalledOnce(); expect(h.settled).toHaveLength(1); expect(h.close).toHaveBeenCalledOnce();
    expect(snapshot.termination).toBe(terminal === 'cancel' ? 'cancelled' : 'commit_failed');
    expect(obs).toMatchObject({ input_tokens: snapshot.inputTokens, output_tokens: snapshot.outputTokens, total_tokens: snapshot.totalTokens });
    expect(obs.usage_raw).toMatchObject({ estimated: snapshot.estimated, termination: snapshot.termination,
      final_output_observed: snapshot.finalOutputObserved, input_usage_validated: snapshot.nativeInputUsageValidated,
      input_usage_source: snapshot.nativeInputUsageSource });
    expect(row.attempts[0].nativeInputPriceUnits40).toBe(snapshot.nativeInputPriceUnits40);
    expect(row).toMatchObject({ input_tokens: 10350, output_tokens: 32000 });
    expect(Number(row.cost_micro_usd)).toBe(65450); expect(obs.output_tokens).toBe(500);
    await h.settlement.settleRoute(h.settled[0]!); await h.attempt.nativeMessages!.finalize!(snapshot);
    expect(await h.ledger()).toHaveLength(2); expect(h.record).toHaveBeenCalledOnce();
  });
});
const growingStart = { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 1 };
const growingDelta = { input_tokens: 150, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 500 };
const repetitions = [{}, { input_tokens: 150 }, { input_tokens: null, cache_read_input_tokens: 2000,
  cache_creation_input_tokens: null }, { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null }];
it.each(MODELS.flatMap((model, index) => repetitions.flatMap((repeat, variant) => [false, true].map(clean =>
  [model, index, repeat, variant, clean] as const))))('prices latest cumulative growing input (%s #%s %s #%s clean=%s)', async (model, index, repeat, _variant, clean) => {
  const chunks = [nativeStart(model, growingStart), nativeFrame('message_delta', { usage: growingDelta }),
    nativeFrame('message_delta', { usage: { ...repeat, output_tokens: 500 } }), ...(clean ? [nativeFrame('message_stop')] : [])];
  await withNativeLedger({ model, chunks, allowanceInput: 10000, allowanceOutput: 32000 }, async h => {
    await h.run(true);
    const row = await h.financial(), obs = await h.observation();
    expect(Number(row.cost_micro_usd)).toBe((index === 2 ? 200 : 350) + (clean ? 1000 : 64000));
    expect(row).toMatchObject({ input_tokens: 2150, output_tokens: clean ? 500 : 32000 });
    expect(row.attempts[0]).toMatchObject({ estimated: !clean, nativeInputUsageValidated: true, nativeInputUsageSource: 'message_delta' });
    expect(obs).toMatchObject({ input_tokens: 2150, output_tokens: 500, total_tokens: 2650 });
    expect(obs.usage_raw.final_output_observed).toBe(clean); expect(obs.usage_raw.input_tokens).toBe(150);
  });
});
it.each(['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'])('a later %s decrease permanently revokes growth proof', async field => {
  const model = MODELS[0]!;
  const start = { ...growingStart, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 } };
  const delta = { ...growingDelta, cache_creation_input_tokens: 10 };
  const decreased = { [field]: Number(delta[field as keyof typeof delta]) - 1, output_tokens: 500 };
  await withNativeLedger({ allowanceInput: 10000, allowanceOutput: 32000, chunks: [nativeStart(model, start),
    nativeFrame('message_delta', { usage: delta }), nativeFrame('message_delta', { usage: decreased }),
    nativeFrame('message_delta', { usage: delta }), nativeFrame('message_stop')] }, async h => {
    await h.run(true); expect(Number((await h.financial()).cost_micro_usd)).toBe(74000);
    expect((await h.observation()).usage_raw).toMatchObject({ estimated: true, input_usage_validated: false });
  });
});
// Official streaming/WebSearch example, spec §5.4 V-1: fields are exact, tool counters remain opaque.
const webStart = { input_tokens: 2679, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 };
const webDelta = { input_tokens: 10682, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  output_tokens: 510, server_tool_use: { web_search_requests: 1 } };
it.each(MODELS.flatMap(model => ['clean', 'interrupted', 'decrease'].map(mode => [model, mode] as const)))
('pins official web-search latest counts and amounts (%s %s)', async (model, mode) => {
  const chunks = [nativeStart(model, webStart), nativeFrame('message_delta', { usage: webDelta }),
    ...(mode === 'decrease' ? [nativeFrame('message_delta', { usage: { input_tokens: 10681, output_tokens: 510 } })] : []),
    ...(mode !== 'interrupted' ? [nativeFrame('message_stop')] : [])];
  await withNativeLedger({ model, chunks, allowanceInput: 20000, allowanceOutput: 32000 }, async h => {
    await h.run(true);
    const row = await h.financial(), obs = await h.observation();
    expect(Number(row.cost_micro_usd)).toBe({ clean: 11702, interrupted: 74682, decrease: 84000 }[mode]);
    expect(obs).toMatchObject({ input_tokens: 10682, output_tokens: 510, total_tokens: 11192 });
    expect(obs.usage_raw).toMatchObject({ input_tokens: 10682, estimated: mode !== 'clean',
      input_usage_validated: mode !== 'decrease', final_output_observed: mode !== 'interrupted' });
    expect(obs.usage_raw.server_tool_use).toBeUndefined(); expect(row.attempts[0].estimated).toBe(mode !== 'clean');
  });
});
it.each([false, true])('keeps physical observation/raw U separate from both financial allowances (stream=%s)', async stream => {
  const model = MODELS[2]!;
  await withNativeLedger({ model, served: MODELS[1], chunks: [nativeStart(MODELS[1]!, mixed), nativeFrame('message_stop')],
    allowanceInput: 20000, allowanceOutput: 32000 }, async h => {
    await h.run(stream);
    const obs = await h.observation(), row = await h.financial();
    expect(obs).toMatchObject({ input_tokens: 10350, output_tokens: 20, total_tokens: 10370, cost_micro_usd: null, hold_id: null });
    expect(obs.usage_raw).toMatchObject({ input_tokens: 100, cache_read_input_tokens: 10000,
      cache_creation_input_tokens: 250, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 50 },
      output_tokens: 20, estimated: true });
    expect(row).toMatchObject({ input_tokens: 20000, output_tokens: 32000 });
    expect(Number(row.cost_micro_usd)).toBe(84000); expect(row.attempts[0].nativeInputPriceUnits40).toBeUndefined();
    expect(obs.idempotency_key).not.toBe(row.idempotency_key);
    expect(JSON.stringify(obs.usage_raw)).not.toContain('32000');
  });
});
it.each([false, true])('persists absent physical input/total as null, never financial floors (stream=%s)', async stream => {
  const usage = { output_tokens: 20 };
  await withNativeLedger({ usage, chunks: [nativeStart(MODELS[0]!, usage), nativeFrame('message_stop')],
    allowanceInput: 100, allowanceOutput: 16 }, async h => {
    await h.run(stream);
    const obs = await h.observation(), row = await h.financial();
    expect(obs).toMatchObject({ input_tokens: null, output_tokens: 20, total_tokens: null });
    expect(obs.usage_raw.input_tokens).toBeUndefined(); expect(obs.usage_raw.cache_read_input_tokens).toBeUndefined();
    expect(row).toMatchObject({ input_tokens: 100, output_tokens: 20 });
    expect(Number(row.cost_micro_usd)).toBe(140); expect(row.attempts[0].estimated).toBe(true);
  });
});
it.each([['claude-fable-5-1', 'claude-opus-5'], ['claude-opus-5', 'claude-fable-5-1']]
  .flatMap(([model, served]) => [false, true].map(stream => [model!, served!, stream] as const)))
('retains selected pinned price and one joined mismatch audit (%s → %s, stream=%s)', async (model, served, stream) => {
  await withNativeLedger({ model, served, allowanceInput: 10350, allowanceOutput: 20,
    chunks: [nativeStart(served, mixed), nativeFrame('message_stop')] }, async h => {
    await h.run(stream);
    const row = await h.financial(), obs = await h.observation();
    expect(Number(row.cost_micro_usd)).toBe(10390); expect(row.pricing_version).toBe(h.pricingId);
    expect(row.attempts[0]).toMatchObject({ modelId: model, nativeServedModelId: served,
      nativeUsageUncertainty: 'served_model_mismatch', estimated: true });
    expect(row.attempts[0].nativeInputPriceUnits40).toBeUndefined();
    expect(obs.model_id).toBe(served); expect(obs.usage_raw.estimated).toBe(true);
    await h.settlement.settleRoute(h.settled[0]!);
    const audit = await h.rows(sql`SELECT b.request_id, b.reason, l.attempts FROM control.blocked_attempts b
      JOIN control.cost_ledger l ON l.idempotency_key = b.request_id AND l.hold_id IS NOT NULL
      WHERE b.request_id = ${h.requestId}`);
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ request_id: h.requestId, reason: 'overrun' });
    expect(audit[0]!.attempts).toEqual(row.attempts); expect(await h.ledger()).toHaveLength(2);
  });
});
it('uses unequal selected pinned rates instead of the independently priced served model', async () => {
  await withNativeLedger({ model: 'claude-fable-5-1', served: 'claude-opus-5', allowanceInput: 10350,
    allowanceOutput: 20, inputRate: 3000000, outputRate: 7000000,
    otherPrice: { model: 'claude-opus-5', input: 99000000, output: 99000000 } }, async h => {
    await h.run(); expect(Number((await h.financial()).cost_micro_usd)).toBe(31190);
    expect((await h.financial()).pricing_version).toBe(h.pricingId); expect(await h.audit()).toHaveLength(1);
  });
});
it.each(['fallback', 'iterations', 'late-model'].flatMap(kind => [false, true].map(stream => [kind, stream] as const)))
('latches %s evidence without discount or raw payload persistence (stream=%s)', async (kind, stream) => {
  const model = MODELS[0]!;
  const usage = { ...mixed, ...(kind === 'iterations' ? { iterations: [{ private: 'fixture-secret' }] } : {}) };
  const extra = kind === 'fallback' ? [nativeFrame('content_block_start', { content_block: { type: 'fallback', token: 'fixture-secret' } })]
    : kind === 'late-model' ? [nativeStart('claude-opus-5', mixed)] : [];
  await withNativeLedger({ usage, served: kind === 'late-model' ? 'claude-opus-5' : model,
    body: kind === 'fallback' ? { content: [{ type: 'fallback', token: 'fixture-secret' }] } : {},
    chunks: [nativeStart(model, usage), ...extra, nativeFrame('message_stop')], allowanceInput: 10350, allowanceOutput: 20 }, async h => {
    await h.run(stream);
    const row = await h.financial(), obs = await h.observation();
    expect(Number(row.cost_micro_usd)).toBe(10390); expect(row.attempts[0].estimated).toBe(true);
    expect(row.attempts[0].nativeInputPriceUnits40).toBeUndefined(); expect(await h.audit()).toHaveLength(1);
    expect(obs.usage_raw).toMatchObject({ uncertainty_reason: 'served_model_mismatch',
      fallback_present: kind === 'fallback', iterations_present: kind === 'iterations', input_usage_validated: false });
    expect(JSON.stringify(await h.ledger())).not.toContain('fixture-secret');
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
