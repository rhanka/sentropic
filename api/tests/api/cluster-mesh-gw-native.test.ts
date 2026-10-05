import { afterEach, expect, it, vi } from 'vitest';
import { gwNativeFixture, message } from './gw-native-fixture';
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
