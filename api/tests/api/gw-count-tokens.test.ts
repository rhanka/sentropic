import { afterEach, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';
import { NativeCountTokensRateLimiter } from '@sentropic/llm-gateway';
import { db } from '../../src/db/client';
import { routePartitionHash } from '../../src/services/llm-metering';
import { gwNativeFixture, message } from './gw-native-fixture';
vi.mock('../../src/services/llm-runtime/index', () => ({
  resolveRuntimeSelection: vi.fn(async ({ model }) => ({ model, providerId: 'anthropic' })), callLLM: vi.fn(), callLLMStream: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());
const path = '/v1/messages/count_tokens';
it('authenticates and checks partition before counting; no generation or billing lifecycle', async () => {
  const h = await gwNativeFixture();
  const counts = async () => (await db.execute(sql`SELECT
    (SELECT count(*) FROM control.cost_ledger WHERE tenant_id = ${h.tenant}) AS ledger,
    (SELECT count(*) FROM control.budget_holds WHERE tenant_id = ${h.tenant}) AS holds,
    (SELECT count(*) FROM control.blocked_attempts WHERE tenant_id = ${h.tenant}) AS blocked`)).rows;
  const before = await counts();
  expect((await h.post(message, {}, path, 'expired')).status).toBe(401);
  expect(h.runtime.nativeCountTokens).not.toHaveBeenCalled();
  const body = { ...message, safeguards: {}, stream: true, future: { preserved: 'é' }, credential: 'caller' };
  const response = await h.post(body, { 'anthropic-beta': 'future-beta', 'x-sentropic-internal-settlement-mode': 'stream' }, path);
  expect(response.status).toBe(200); expect(response.headers.get('x-sentropic-request-id')).toBeTruthy();
  expect(await response.json()).toEqual({ input_tokens: 17, extension: { retained: true } });
  expect(h.runtime.nativeCountTokens.mock.calls[0]![0]).toMatchObject({ body,
    credential: 'fixture-server-key', headers: { anthropicVersion: '2023-06-01', forwarded: { 'anthropic-beta': 'future-beta' } } });
  expect(h.quote).not.toHaveBeenCalled(); expect(h.budget.admit).not.toHaveBeenCalled();
  expect(h.budget.markDispatched).not.toHaveBeenCalled(); expect(h.budget.release).not.toHaveBeenCalled();
  expect(h.settlement.settleRoute).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
  expect(h.generate).not.toHaveBeenCalled(); expect(await counts()).toEqual(before);
  h.partition.tenants[h.tenant]!.product = [h.users[1]!];
  h.partition.hash = routePartitionHash(h.partition.revision, h.partition.tenants);
  expect((await h.post(message, {}, path)).status).toBe(401);
  h.partition.hash = 'stale'; expect((await h.post(message, {}, path, 'b')).status).toBe(503);
  expect(h.runtime.nativeCountTokens).toHaveBeenCalledOnce();
});
it('distinct_principals_have_independent_count_limits', async () => {
  const rate = new NativeCountTokensRateLimiter({ capacity: 1, maxInFlight: 1, now: () => 0 });
  const h = await gwNativeFixture(true, { nativeCountRate: rate });
  expect(h.users[0]).not.toBe(h.users[1]);
  expect((await h.post(message, {}, path, 'a')).status).toBe(200);
  const blocked = await h.post(message, {}, path, 'a');
  expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('1');
  expect((await h.post(message, {}, path, 'b')).status).toBe(200);
  expect(h.runtime.nativeCountTokens).toHaveBeenCalledTimes(2);
  const identities = h.caller.mock.results.map(result => result.value.principalId);
  expect(new Set(identities).size).toBe(2);
});
it('second_session_same_principal_shares_count_limits', async () => {
  const rate = new NativeCountTokensRateLimiter({ capacity: 1, maxInFlight: 1, now: () => 0 });
  const h = await gwNativeFixture(true, { nativeCountRate: rate });
  expect((await h.post(message, {}, path, 'a')).status).toBe(200);
  expect((await h.post(message, {}, path, 'a2')).status).toBe(429);
  expect(h.caller.mock.results[0]!.value.principalId).toBe(h.caller.mock.results[1]!.value.principalId);
  expect(h.caller.mock.results[0]!.value.ownerScopeRef).toBe(h.caller.mock.results[1]!.value.ownerScopeRef);
  expect(h.runtime.nativeCountTokens).toHaveBeenCalledOnce();
});
it('releases concurrent count slots after error and refills without generation lifecycle', async () => {
  let now = 0;
  const rate = new NativeCountTokensRateLimiter({ capacity: 2, maxInFlight: 1, now: () => now });
  const h = await gwNativeFixture(true, { nativeCountRate: rate });
  let started!: () => void, reject!: (error: unknown) => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  h.runtime.nativeCountTokens.mockImplementationOnce(() => {
    started(); return new Promise((_resolve, fail) => { reject = fail; });
  });
  const pending = h.post(message, {}, path);
  await start;
  expect((await h.post(message, {}, path, 'a2')).status).toBe(429);
  expect((await h.post(message, {}, path, 'b')).status).toBe(200);
  reject(new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' }));
  expect((await pending).status).toBe(503);
  expect((await h.post(message, {}, path, 'a2')).status).toBe(200);
  expect((await h.post(message, {}, path)).status).toBe(429);
  now = 1000;
  expect((await h.post(message, {}, path)).status).toBe(200);
  expect(h.budget.admit).not.toHaveBeenCalled(); expect(h.settlement.settleRoute).not.toHaveBeenCalled();
});
it.each([false, true])('OFF refusal names safeguards when present (%s)', async safeguards => {
  const h = await gwNativeFixture(false);
  const response = await h.post({ ...message, ...(safeguards ? { safeguards: {} } : {}) }, {}, path);
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(safeguards ? 'safeguards' : 'Token counting');
  expect(h.credential).not.toHaveBeenCalled(); expect(h.runtime.nativeCountTokens).not.toHaveBeenCalled();
});
it.each([['missing-fixture', 404], ['gpt-5.6-terra', 400], ['claude-opus-5-5', 400], ['claude-opus-5', 400]])('denies %s with %s before HTTP', async (model, status) => {
  const h = await gwNativeFixture();
  expect((await h.post({ ...message, model }, {}, path)).status).toBe(status);
  expect(h.credential).not.toHaveBeenCalled(); expect(h.runtime.nativeCountTokens).not.toHaveBeenCalled();
});
it('rejects unsupported version, malformed provider count and sanitized provider error without billing', async () => {
  const h = await gwNativeFixture();
  expect((await h.post(message, { 'anthropic-version': 'unsupported' }, path)).status).toBe(400);
  h.runtime.nativeCountTokens.mockResolvedValueOnce({ kind: 'json', status: 200, headers: {}, body: { input_tokens: -1 } });
  expect((await h.post(message, {}, path)).status).toBe(503);
  h.runtime.nativeCountTokens.mockRejectedValueOnce(new NativeMessagesUpstreamError({ status: 429, code: 'rate_limit_error' }));
  expect((await h.post(message, {}, path)).status).toBe(429);
  expect(h.settlement.settleRoute).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
});
