import { expect, it, vi } from 'vitest';
import { MuseRuntimeClient } from '../src/transport/muse-runtime-client.js';
import { transportSupportsExecutionFeatures } from '../src/execution-features.js';
it.each(['generate', 'stream'] as const)('keeps Muse %s blocked when the required effort has no proven transport slot', async (method) => {
  const fetch = vi.fn(); const client = new MuseRuntimeClient({ fetch });
  const request = { providerId: 'muse' as const, modelId: 'muse-spark-1.3', messages: [], reasoning: { effort: 'high' as const, summary: 'auto' as const } };
  const original = structuredClone(request);
  await expect(client[method](request)).rejects.toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
  expect(request).toEqual(original); expect(fetch).not.toHaveBeenCalled();
  expect(transportSupportsExecutionFeatures('muse', ['reasoning-controls'])).toBe(false);
});
