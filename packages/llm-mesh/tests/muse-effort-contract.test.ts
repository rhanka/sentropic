import { describe, expect, it, vi } from 'vitest';
import { MuseRuntimeClient } from '../src/transport/muse-runtime-client.js';
import { transportSupportsExecutionFeatures } from '../src/execution-features.js';

// Wire evidence (no credentials): Meta Reasoning docs nest the Responses
// control as `reasoning: { "effort": ... }` (`reasoning_effort` is the Chat
// Completions spelling), `none` returns HTTP 400 on Wonder/Spark/Ember and
// `max` covers muse-wonder-1.0, muse-spark-1.3 and muse-ember-1.0; the muse
// CLI bundle (muse-bin-1.4.25-R9361.1) carries `reasoning` with nested
// `effort`/`summary`, and its provider catalog (`tbh`) lists low..max
// variants for the models below but only up to `xhigh` for muse-spark-1.2;
// Muse docs add that Meta rejects `none` and offers `max` in both
// Standard and Contributor mode (the surface this client emulates).
const auth = { auth: { material: { type: 'account-transport' as const, provider: 'muse' as const, accessToken: 'secret-muse-token', accountId: 'acct_muse_1' }, descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'muse' as const } } };
const LOW_TO_MAX = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const LOW_TO_MAX_MODELS = ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-wonder-1.0', 'muse-wonder-full-1.0', 'muse-ember-1.0'] as const;
const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ id: 'resp-1', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
const bodyOf = (fetchFn: { mock: { calls: unknown[][] } }): Record<string, unknown> => JSON.parse(String((fetchFn.mock.calls[0]![1] as { body: unknown }).body)) as Record<string, unknown>;

describe('muse reasoning effort contract', () => {
  it('projects reasoning { effort } for every supported effort on every low..max model', async () => {
    for (const modelId of LOW_TO_MAX_MODELS) {
      for (const effort of LOW_TO_MAX) {
        const fetchFn = okFetch();
        const client = new MuseRuntimeClient({ fetch: fetchFn });
        await client.generate({ providerId: 'muse', modelId, messages: [{ role: 'user', content: 'hello' }], reasoning: { effort } }, auth);
        expect(fetchFn).toHaveBeenCalledOnce();
        const body = bodyOf(fetchFn);
        expect(body).toMatchObject({ model: modelId, reasoning: { effort } });
        expect(body).not.toHaveProperty('reasoning_effort');
      }
    }
    expect(transportSupportsExecutionFeatures('muse', ['reasoning-controls'])).toBe(true);
  });

  it('projects reasoning { effort } on the stream wire too', async () => {
    const fetchFn = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    const stream = await client.stream({ providerId: 'muse', modelId: 'muse-wonder-full-1.0', messages: [{ role: 'user', content: 'hello' }], reasoning: { effort: 'max' } }, auth);
    for await (const _ of stream) { /* drain */ }
    expect(bodyOf(fetchFn)).toMatchObject({ stream: true, reasoning: { effort: 'max' } });
  });

  it('sends no reasoning field when the request carries no reasoning controls', async () => {
    for (const reasoning of [undefined, {}] as const) {
      const fetchFn = okFetch();
      const client = new MuseRuntimeClient({ fetch: fetchFn });
      await client.generate({ providerId: 'muse', modelId: 'muse-wonder-1.0', messages: [{ role: 'user', content: 'hello' }], ...(reasoning ? { reasoning } : {}) }, auth);
      const body = bodyOf(fetchFn);
      expect(body).not.toHaveProperty('reasoning');
      expect(body).not.toHaveProperty('reasoning_effort');
    }
  });

  it.each(['generate', 'stream'] as const)('refuses unsupported efforts before Meta I/O on %s', async (method) => {
    const fetchFn = vi.fn();
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    for (const modelId of LOW_TO_MAX_MODELS) {
      await expect(client[method]({ providerId: 'muse', modelId, messages: [], reasoning: { effort: 'none' } }, auth)).rejects.toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses max on muse-spark-1.2 with the precise supported list', async () => {
    const fetchFn = vi.fn();
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    const request = { providerId: 'muse' as const, modelId: 'muse-spark-1.2', messages: [], reasoning: { effort: 'max' as const } };
    const original = structuredClone(request);
    const err = await client.generate(request, auth).catch((e: Error) => e);
    expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    expect((err as Error).message).toBe('Muse model muse-spark-1.2 does not support reasoning effort "max" (supported: low, medium, high, xhigh)');
    expect(request).toEqual(original);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses out-of-ladder and unknown-model efforts before Meta I/O', async () => {
    const fetchFn = vi.fn();
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    for (const effort of ['minimal', 'ultra', 'bogus']) {
      await expect(client.generate({ providerId: 'muse', modelId: 'muse-wonder-1.0', messages: [], reasoning: { effort: effort as never } }, auth)).rejects.toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    }
    await expect(client.generate({ providerId: 'muse', modelId: 'muse-unknown-9.9', messages: [], reasoning: { effort: 'low' } }, auth)).rejects.toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('projects reasoning.summary next to effort and refuses controls without a wire slot', async () => {
    const fetchFn = okFetch();
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    await client.generate({ providerId: 'muse', modelId: 'muse-spark-1.3', messages: [{ role: 'user', content: 'hello' }], reasoning: { effort: 'high', summary: 'auto' } }, auth);
    expect(bodyOf(fetchFn).reasoning).toEqual({ effort: 'high', summary: 'auto' });
    const refusedFetch = vi.fn();
    const refusedClient = new MuseRuntimeClient({ fetch: refusedFetch });
    for (const reasoning of [{ effort: 'high' as const, enabled: true }, { effort: 'high' as const, budgetTokens: 1024 }, { effort: 'high' as const, summary: 'verbose' as never }]) {
      await expect(refusedClient.generate({ providerId: 'muse', modelId: 'muse-spark-1.3', messages: [], reasoning }, auth)).rejects.toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
    }
    expect(refusedFetch).not.toHaveBeenCalled();
  });
});
