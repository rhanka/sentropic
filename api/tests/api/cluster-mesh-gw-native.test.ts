import { afterEach, expect, it, vi } from 'vitest';
import { gwNativeFixture, message } from './gw-native-fixture';
import { defaultGatewayBodyBytePool, GatewayBodyBytePool } from '@sentropic/llm-gateway';
import { routePartitionHash } from '../../src/services/llm-metering';
vi.mock('../../src/services/llm-runtime/index', () => ({
  resolveRuntimeSelection: vi.fn(async ({ model }) => ({ model, providerId: 'anthropic' })), callLLM: vi.fn(), callLLMStream: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());
it('uses real product session authentication before bounded ingress', async () => {
  const h = await gwNativeFixture(false);
  expect((await h.post({ ...message, safeguards: {} }, {}, undefined, 'expired')).status).toBe(401);
  expect(h.caller).not.toHaveBeenCalled(); expect(h.quote).not.toHaveBeenCalled();
  expect((await h.app.request('/api/v1/gw/readyz')).status).toBe(200);
});
it.each([undefined, {}, null])('names safeguards while OFF before model lookup (%s)', async safeguards => {
  const h = await gwNativeFixture(false);
  const response = await h.post({ ...message, model: 'unknown-fixture', safeguards });
  if (safeguards === undefined) {
    // JSON serialization omits undefined; absence preserves the canonical unknown-model error.
    expect(response.status).toBe(404);
  } else {
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('safeguards');
    expect(h.quote).not.toHaveBeenCalled();
  }
  expect(h.budget.admit).not.toHaveBeenCalled(); expect(h.runtime.nativeMessages).not.toHaveBeenCalled();
});
it.each([false, true])('keeps version-only canonical, unknown extensions and shared-pool release (enabled=%s)', async enabled => {
  const baseline = defaultGatewayBodyBytePool.stats.reservedBytes;
  const h = await gwNativeFixture(enabled);
  expect((await h.post(message, { 'anthropic-version': '2023-06-01' })).status).toBe(200);
  expect(h.generate).toHaveBeenCalledOnce(); expect(h.runtime.nativeMessages).not.toHaveBeenCalled();
  expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(baseline);
});
it('relays ON safeguards/extensions without exposing caller credential selection', async () => {
  const h = await gwNativeFixture();
  const body = { ...message, safeguards: { mode: 'auto' }, future_extension: { unicode: 'é' }, credential: 'caller-key' };
  const response = await h.post(body, { 'anthropic-beta': 'fixture-beta', 'anthropic-version': '2023-06-01' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ safeguard_results: { action: 'allow' } });
  expect(h.runtime.nativeMessages).toHaveBeenCalledOnce(); expect(h.generate).not.toHaveBeenCalled();
  expect(h.runtime.nativeMessages.mock.calls[0]![0]).toMatchObject({ body, credential: 'fixture-server-key' });
});
it.each([['unknown-fixture', 404], ['gpt-5.6-terra', 400], ['claude-opus-5-5', 400]])('refuses required model %s before admission', async (model, status) => {
  const h = await gwNativeFixture();
  expect((await h.post({ ...message, model, safeguards: {} })).status).toBe(status);
  expect(h.budget.admit).not.toHaveBeenCalled(); expect(h.runtime.nativeMessages).not.toHaveBeenCalled();
});
it('keeps partition/readiness fail-closed and ingress byte refusal before quote/admission', async () => {
  const pool = new GatewayBodyBytePool(64);
  const h = await gwNativeFixture(true, { bodyLimit: { limitBytes: 64, pool } });
  expect((await h.post(message)).status).toBe(413);
  expect(h.quote).not.toHaveBeenCalled(); expect(h.budget.admit).not.toHaveBeenCalled();
  expect(pool.stats.reservedBytes).toBe(0);
  h.partition.tenants[h.tenant]!.product = [];
  h.partition.hash = routePartitionHash(h.partition.revision, h.partition.tenants);
  expect((await h.post({ model: 'fixture', messages: [] })).status).toBe(401);
  h.partition.hash = 'stale';
  expect((await h.app.request('/api/v1/gw/readyz')).status).toBe(503);
});
