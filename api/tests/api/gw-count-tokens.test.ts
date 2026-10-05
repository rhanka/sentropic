import { afterEach, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';
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
