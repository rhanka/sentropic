import { describe, expect, it, vi } from 'vitest';
import { KEV_SERVED_MODEL_ID } from '../src/decision/host.js';
import { encodeJevRequest } from '../src/decision/jev-codec.js';
import { kevFixture } from './decision-kev-fixtures.js';

const encoded = (f: ReturnType<typeof kevFixture>) => {
  const value = encodeJevRequest(f.request, f.descriptor);
  if (!value.ok) throw new Error(value.code);
  return value.bodyJson;
};
describe('fixed System One local transport', () => {
  it('should refuse a wrong requested model even when a single-model server would ignore it (P26)', async () => {
    const f = kevFixture();
    const body = JSON.parse(encoded(f));
    body.model = 'Kev-4B-Q4_K_M.gguf';
    expect(await f.transport.send(JSON.stringify(body), 'fixture-token')).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' } });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.verifyInventory).not.toHaveBeenCalled();
  });
  it.each([
    { data: [] }, { data: [{ id: KEV_SERVED_MODEL_ID }] },
    { data: [{ id: 'foreign', architecture: { output_modalities: ['decisions'] } }] },
    { data: [{ id: KEV_SERVED_MODEL_ID, architecture: { output_modalities: ['text'] } }] },
  ])('should refuse absent or non-native served identity without POST %j', async (models) => {
    const f = kevFixture();
    f.fetch.mockImplementation(async () => new Response(JSON.stringify(models), { headers: { 'content-type': 'application/json' } }));
    expect(await f.transport.send(encoded(f), 'fixture-token')).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' } });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('should refuse multiple models and a changed inventory after execution', async () => {
    const f = kevFixture();
    f.models.data.push(structuredClone(f.models.data[0]));
    expect((await f.transport.send(encoded(f), 'fixture-token')).ok).toBe(false);
    f.models.data.pop();
    f.verifyInventory.mockResolvedValueOnce(f.inventory).mockResolvedValueOnce(null as never);
    expect(await f.transport.send(encoded(f), 'fixture-token')).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' } });
    expect(f.fetch.mock.calls.filter(([url]) => url.endsWith('/systemone'))).toHaveLength(1);
  });
  it.each([302, 401, 429, 500])('should reject HTTP %i without replay or redirect', async (status) => {
    const f = kevFixture();
    f.fetch.mockImplementation(async () => new Response('', { status, headers: { location: 'https://foreign.invalid' } }));
    expect((await f.transport.send(encoded(f), 'fixture-token')).ok).toBe(false);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }),
    () => new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }),
  ])('should bound and validate each response without replay', async (response) => {
    const f = kevFixture();
    f.fetch.mockImplementation(async () => response());
    expect((await f.transport.send(encoded(f), 'fixture-token')).ok).toBe(false);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('should bound a hanging verifier and forbid late egress', async () => {
    vi.useFakeTimers();
    try {
      const f = kevFixture();
      let release!: (value: typeof f.inventory) => void;
      f.verifyInventory.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      const pending = f.transport.send(encoded(f), 'fixture-token', { timeoutMs: 5 });
      await vi.advanceTimersByTimeAsync(5);
      expect(await pending).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
      release(f.inventory);
      await vi.runAllTimersAsync();
      expect(f.fetch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('should cancel a never-ending response stream and refuse pre-aborted requests', async () => {
    const f = kevFixture();
    const controller = new AbortController();
    const cancel = vi.fn();
    f.fetch.mockImplementation(async () => new Response(new ReadableStream({ cancel }),
      { headers: { 'content-type': 'application/json' } }));
    const pending = f.transport.send(encoded(f), 'fixture-token', { signal: controller.signal });
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(cancel).toHaveBeenCalledTimes(1);
    f.fetch.mockClear();
    expect((await f.transport.send(encoded(f), 'fixture-token', { signal: controller.signal })).ok).toBe(false);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
