import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { createGatewayRouter, runRouteJsonFlow, runRouteStreamFlow } from '@sentropic/llm-gateway';
import type { RouteRequestSettlement } from '@sentropic/llm-gateway';
import type { NativeUsageSnapshot } from '@sentropic/llm-mesh';
import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';
import { nativeHarness, nativeFrame, nativeStart } from '../../../packages/llm-gateway/tests/fixtures/native-flow';
import { db } from '../../src/db/client';
import { createBudgetAdmission, createRouteSettlement, insertModelPricing, recordLlmUsage } from '../../src/services/llm-metering';
import { createAnthropicNativePort } from '../../src/services/llm-runtime/anthropic-native';
export { nativeFrame, nativeStart };
export const MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1'];
export const mixed = { input_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 250,
  cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 50 }, output_tokens: 20 };
type Options = { model?: string; served?: string; usage?: Record<string, unknown>; body?: Record<string, unknown>;
  chunks?: Uint8Array[]; allowanceInput?: number; allowanceOutput?: number; inputRate?: number; outputRate?: number;
  requestBody?: Record<string, unknown>; preFetchFailure?: boolean };
/** Real Postgres admission/settlement; pricing changes roll back, observation cleanup is fixture-keyed only. */
export const withNativeLedger = async (options: Options, check: (h: Awaited<ReturnType<typeof build>>) => Promise<void>) => {
  const user = `native-ledger-${randomUUID()}`;
  const rollback = new Error('fixture rollback');
  try {
    await db.transaction(async tx => {
      const h = await build(options, tx, user);
      await check(h); await Promise.all(h.writes);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.execute(sql`DELETE FROM control.cost_ledger WHERE user_id = ${user} AND hold_id IS NULL`); }
};
const build = async (options: Options, tx: Parameters<Parameters<typeof db.transaction>[0]>[0], user: string) => {
  const model = options.model ?? MODELS[0]!;
  const requestId = `native-request-${randomUUID()}`;
  const pricingId = `native-price-${randomUUID()}`;
  const clock = new Date('2099-01-02T00:00:00Z');
  await insertModelPricing(tx as unknown as typeof db, { id: pricingId, providerId: 'anthropic', modelId: model,
    inputMicroUsdPerMtok: options.inputRate ?? 1_000_000, outputMicroUsdPerMtok: options.outputRate ?? 2_000_000,
    effectiveFrom: new Date('2099-01-01T00:00:00Z') });
  await tx.execute(sql`INSERT INTO control.tenant_budget_strategy (id, tenant_id, funding_mode, key_sourcing_mode)
    VALUES (${user}, ${user}, 'tenant_pool', 'platform')`);
  await tx.execute(sql`INSERT INTO control.budgets (id, tenant_id, scope_kind, scope_key, cap_micro_usd, reset_at)
    VALUES (${user}, ${user}, 'tenant', ${user}, 100000000, '2100-01-01')`);
  const cost = { tenantId: user, workspaceId: `${user}-ws`, principalId: user, ownerScopeRef: user,
    source: 'fixture', correlationId: `correlation-${randomUUID()}` };
  const admission = createBudgetAdmission({ database: tx as unknown as typeof db, ownerRef: 'native-ledger', now: () => clock });
  const settlement = createRouteSettlement({ database: tx as unknown as typeof db });
  const settled: RouteRequestSettlement[] = [], snapshots: NativeUsageSnapshot[] = [], writes: Promise<void>[] = [];
  const record = vi.fn((observation: Parameters<typeof recordLlmUsage>[0]) => {
    const pending = recordLlmUsage(observation); writes.push(pending); return pending;
  });
  const close = vi.fn(async () => ({ done: true as const, value: undefined }));
  const chunks = options.chunks ?? [nativeStart(model, options.usage ?? mixed), nativeFrame('message_stop')];
  let index = 0;
  const port = createAnthropicNativePort({ modelIds: [model], record,
    dependencies: { resolveProviderCredential: vi.fn(async () => ({ providerId: 'anthropic', source: 'environment', credential: 'fake' })) },
    runtime: { nativeCountTokens: vi.fn(), nativeMessages: vi.fn(async payload => {
      if (options.preFetchFailure) throw new NativeMessagesUpstreamError({ status: 503, code: 'account_unavailable',
        usage: { inputTokens: 0, outputTokens: 0, estimated: false } });
      payload.onResponseStarted();
      return payload.stream ? { kind: 'stream' as const, status: 200, headers: {}, body: { [Symbol.asyncIterator]: () => ({
        next: async () => index < chunks.length ? { done: false as const, value: chunks[index++]! }
          : { done: true as const, value: undefined }, return: close }) } }
        : { kind: 'json' as const, status: 200, headers: {}, body: { model: options.served ?? model,
          usage: options.usage ?? mixed, ...options.body } };
    }) } });
  const capability = (await port.prepare({ principalRef: user, ownerScopeRef: user }, cost.workspaceId,
    { providerId: 'anthropic', modelId: model }))!;
  const h = nativeHarness({ model, allowanceInput: options.allowanceInput, allowanceOutput: options.allowanceOutput,
    body: options.requestBody });
  h.attempt.nativeMessages = { ...capability, finalize: vi.fn(snapshot => {
    snapshots.push(snapshot); return capability.finalize!(snapshot);
  }) };
  const config = { ...h.deps.config, callerAuth: { verify: async () => ({ ok: true as const, cost }) } };
  const metering = { settleRoute: vi.fn(async (value: RouteRequestSettlement) => {
    settled.push(value); await settlement.settleRoute(value);
  }) };
  const deps = { ...h.deps, config, metering, budget: { port: admission, now: () => clock.getTime() } };
  h.request.authContext.requestId = requestId;
  const run = async (stream = false, terminal?: 'cancel' | 'commit-failure') => {
    if (!stream) {
      try { await runRouteJsonFlow(deps, h.request); } catch (error) { if (!options.preFetchFailure) throw error; }
    }
    else {
      if (terminal === 'commit-failure') h.attempt.markCommitted.mockRejectedValue(new Error('fixture commit failure'));
      let flow;
      try { flow = await runRouteStreamFlow(deps, { ...h.request, stream: true }); }
      catch (error) { if (terminal !== 'commit-failure') throw error; await Promise.all(writes); return; }
      const iterator = flow.stream[Symbol.asyncIterator]();
      if (terminal === 'cancel') await iterator.return?.();
      else { while (!(await iterator.next()).done) { /* Drain provider bytes. */ } }
    }
    await Promise.all(writes);
  };
  const router = createGatewayRouter({ config, routePlanner: deps.routePlanner, routeMetering: metering,
    budget: deps.budget, nativeMessagesEnabled: true, requestId: () => requestId });
  const rows = async (query: ReturnType<typeof sql>) => (await tx.execute(query)).rows as Record<string, any>[];
  const ledger = () => rows(sql`SELECT * FROM control.cost_ledger WHERE idempotency_key = ${requestId} OR response_id = ${requestId}`);
  const financial = async () => (await ledger()).find(row => row.hold_id !== null)!;
  const observation = async () => (await ledger()).find(row => row.hold_id === null)!;
  const audit = () => rows(sql`SELECT * FROM control.blocked_attempts WHERE request_id = ${requestId}`);
  return { ...h, run, router, requestId, pricingId, admission, settlement, cost, snapshots, record, writes, close,
    settled, metering, rows, ledger, financial, observation, audit };
};
