import { describe, expect, it, vi } from 'vitest';
import { MuseRuntimeClient } from '../src/transport/muse-runtime-client.js';
import { transportSupportsExecutionFeatures } from '../src/execution-features.js';
import { getModelProfile, MUSE_REASONING_EFFORTS } from '../src/catalog.js';

// Wire evidence (no credentials): Meta Reasoning docs nest the Responses
// control as `reasoning: { "effort": ... }` (`reasoning_effort` is the Chat
// Completions spelling), `none` returns HTTP 400 on Wonder/Spark/Ember and
// `max` is supported by muse-wonder-1.0, muse-spark-1.3 and muse-ember-1.0
// but "isn't available with muse-spark-1.3-contributor" (official Meta
// Reasoning + Muse Spark docs, re-checked 2026-11-23); the local muse
// catalog cache listing a contributor max variant does not override that
// primary source, so contributor stays low..xhigh here. The muse CLI
// bundle (muse-bin-1.4.25-R9361.1) carries `reasoning` with nested
// `effort`/`summary`. The muse-spark-1.2 `xhigh` ceiling comes from the
// local provider catalog cache (schema 3, `provider_catalog`, profile
// `tbh`: `reasoning_effort_variants` minimal..xhigh), not the Meta docs,
// which give no range for 1.2. Upstream `minimal` exists on Meta models
// but is outside the mesh `ReasoningEffort` ladder, so its refusal is
// worded as a ladder refusal, never as a model limitation.
const auth = { auth: { material: { type: 'account-transport' as const, provider: 'muse' as const, accessToken: 'secret-muse-token', accountId: 'acct_muse_1' }, descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'muse' as const } } };
const LOW_TO_MAX = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const LOW_TO_XHIGH = ['low', 'medium', 'high', 'xhigh'] as const;
const LOW_TO_MAX_MODELS = ['muse-spark-1.3', 'muse-wonder-1.0', 'muse-wonder-full-1.0', 'muse-ember-1.0'] as const;
const LOW_TO_XHIGH_MODELS = ['muse-spark-1.3-contributor', 'muse-spark-1.2', 'muse-spark-1.2-contributor'] as const;
const ALL_MODELS = [...LOW_TO_MAX_MODELS, ...LOW_TO_XHIGH_MODELS] as const;
const refusal = async (p: Promise<unknown>): Promise<Error> => p.catch((e: Error) => e) as Promise<Error>;
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

  it('projects low..xhigh on contributor and spark-1.2 models, refusing max precisely', async () => {
    for (const modelId of LOW_TO_XHIGH_MODELS) {
      for (const effort of LOW_TO_XHIGH) {
        const fetchFn = okFetch();
        await new MuseRuntimeClient({ fetch: fetchFn }).generate({ providerId: 'muse', modelId, messages: [{ role: 'user', content: 'hello' }], reasoning: { effort } }, auth);
        expect(bodyOf(fetchFn)).toMatchObject({ model: modelId, reasoning: { effort } });
      }
      const fetchFn = vi.fn();
      const err = await refusal(new MuseRuntimeClient({ fetch: fetchFn }).generate({ providerId: 'muse', modelId, messages: [], reasoning: { effort: 'max' } }, auth));
      expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
      expect(err.message).toBe(`Muse model ${modelId} does not support reasoning effort "max" (supported: low, medium, high, xhigh)`);
      expect(fetchFn).not.toHaveBeenCalled();
    }
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
    for (const modelId of ALL_MODELS) {
      const supported = (LOW_TO_MAX_MODELS as readonly string[]).includes(modelId) ? 'low, medium, high, xhigh, max' : 'low, medium, high, xhigh';
      const err = await refusal(client[method]({ providerId: 'muse', modelId, messages: [], reasoning: { effort: 'none' } }, auth));
      expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
      expect(err.message).toBe(`Muse model ${modelId} does not support reasoning effort "none" (supported: ${supported})`);
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
      const err = await refusal(client.generate({ providerId: 'muse', modelId: 'muse-wonder-1.0', messages: [], reasoning: { effort: effort as never } }, auth));
      expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
      expect(err.message).toBe(`Muse reasoning effort "${effort}" is outside the mesh ReasoningEffort ladder (supported by muse-wonder-1.0: low, medium, high, xhigh, max)`);
    }
    for (const modelId of ['muse-unknown-9.9', 'constructor', 'toString', '__proto__']) {
      const err = await refusal(client.generate({ providerId: 'muse', modelId: modelId as never, messages: [], reasoning: { effort: 'low' } }, auth));
      expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
      expect(err.message).toBe(`Unknown Muse model ${modelId}: no reasoning efforts are supported`);
      expect(err).not.toBeInstanceOf(TypeError);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('projects reasoning.summary next to effort and refuses controls without a wire slot', async () => {
    const fetchFn = okFetch();
    const client = new MuseRuntimeClient({ fetch: fetchFn });
    await client.generate({ providerId: 'muse', modelId: 'muse-spark-1.3', messages: [{ role: 'user', content: 'hello' }], reasoning: { effort: 'high', summary: 'auto' } }, auth);
    expect(bodyOf(fetchFn).reasoning).toEqual({ effort: 'high', summary: 'auto' });
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ effort: 'high', enabled: true }, 'Muse Responses cannot preserve reasoning.enabled'],
      [{ effort: 'high', budgetTokens: 1024 }, 'Muse Responses cannot preserve reasoning.budgetTokens'],
      [{ effort: 'high', summary: 'verbose' }, 'Muse Responses does not support reasoning summary "verbose" (supported: auto, concise, detailed)'],
    ];
    const refusedFetch = vi.fn();
    const refusedClient = new MuseRuntimeClient({ fetch: refusedFetch });
    for (const [reasoning, message] of cases) {
      const err = await refusal(refusedClient.generate({ providerId: 'muse', modelId: 'muse-spark-1.3', messages: [], reasoning: reasoning as never }, auth));
      expect(err).toMatchObject({ status: 400, code: 'unsupported_projection', param: 'reasoning' });
      expect(err.message).toBe(message);
    }
    expect(refusedFetch).not.toHaveBeenCalled();
  });

  it('projects summary-only on known models (incl. stream) and refuses it on unknown models', async () => {
    const fetchFn = okFetch();
    await new MuseRuntimeClient({ fetch: fetchFn }).generate({ providerId: 'muse', modelId: 'muse-spark-1.3-contributor', messages: [{ role: 'user', content: 'hello' }], reasoning: { summary: 'concise' } }, auth);
    expect(bodyOf(fetchFn).reasoning).toEqual({ summary: 'concise' });
    const streamFetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const stream = await new MuseRuntimeClient({ fetch: streamFetch }).stream({ providerId: 'muse', modelId: 'muse-wonder-1.0', messages: [{ role: 'user', content: 'hello' }], reasoning: { effort: 'high', summary: 'detailed' } }, auth);
    for await (const _ of stream) { /* drain */ }
    expect(bodyOf(streamFetch).reasoning).toEqual({ effort: 'high', summary: 'detailed' });
    const refusedFetch = vi.fn();
    const err = await refusal(new MuseRuntimeClient({ fetch: refusedFetch }).generate({ providerId: 'muse', modelId: 'muse-unknown-9.9' as never, messages: [], reasoning: { summary: 'auto' } }, auth));
    expect(err.message).toBe('Unknown Muse model muse-unknown-9.9: no reasoning efforts are supported');
    expect(refusedFetch).not.toHaveBeenCalled();
  });

  // Last on purpose: on unfrozen code the attempted push below would widen
  // the shared array for the rest of this file.
  it('freezes the single effort table so no consumer can widen the validator', async () => {
    expect(Object.isFrozen(MUSE_REASONING_EFFORTS)).toBe(true);
    for (const efforts of Object.values(MUSE_REASONING_EFFORTS)) {
      expect(Object.isFrozen(efforts)).toBe(true);
    }
    const contributor = MUSE_REASONING_EFFORTS['muse-spark-1.3-contributor']!;
    expect(getModelProfile('muse', 'muse-spark-1.3-contributor' as never)
      ?.capabilities.reasoning.supportedEfforts).toBe(contributor);
    expect(() => { (contributor as unknown as string[]).push('max'); }).toThrow(TypeError);
    expect(contributor).toEqual(['low', 'medium', 'high', 'xhigh']);
    const fetchFn = vi.fn();
    const err = await refusal(new MuseRuntimeClient({ fetch: fetchFn }).generate(
      { providerId: 'muse', modelId: 'muse-spark-1.3-contributor', messages: [], reasoning: { effort: 'max' } }, auth));
    expect(err.message).toBe('Muse model muse-spark-1.3-contributor does not support reasoning effort "max" (supported: low, medium, high, xhigh)');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
