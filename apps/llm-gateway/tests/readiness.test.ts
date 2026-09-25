import { describe, expect, it, vi } from 'vitest';

import { createHostApp } from '../src/app';
import { createHostReadiness, READINESS_CACHE_MS, PROBE_TIMEOUT_MS } from '../src/readiness';
import { AUTHORIZATION, chatRequest, fixtureCallerAuth, fixtureDependencies, testConfig } from './fixtures';

describe('host readiness probes', () => {
  it('bounds probes to 2 s and caches results for 5 s', () => {
    expect(PROBE_TIMEOUT_MS).toBe(2_000);
    expect(READINESS_CACHE_MS).toBe(5_000);
  });

  it('is not ready without probes or with any failing probe, reporting only name and kind', async () => {
    expect(await createHostReadiness({ probes: [] }).isReady()).toBe(false);
    const failures: string[] = [];
    const readiness = createHostReadiness({
      probes: [
        { name: 'identity', check: async () => true },
        { name: 'routing', check: async () => false },
        { name: 'settlement', check: async () => { throw new Error('postgres://user:password@db'); } },
      ],
      onProbeFailure: (name, failure) => failures.push(`${name}:${failure}`),
    });
    expect(await readiness.isReady()).toBe(false);
    expect(failures.sort()).toEqual(['routing:not-ready', 'settlement:error']);
  });

  it('times out a hanging probe and aborts its signal', async () => {
    let signal: AbortSignal | undefined;
    const failures: string[] = [];
    const readiness = createHostReadiness({
      timeoutMs: 20,
      probes: [{ name: 'identity', check: (s) => { signal = s; return new Promise<boolean>(() => undefined); } }],
      onProbeFailure: (name, failure) => failures.push(`${name}:${failure}`),
    });
    expect(await readiness.isReady()).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(failures).toEqual(['identity:timeout']);
  });

  it('serves the cached result inside the cache window and re-evaluates after it', async () => {
    let clock = 1_000;
    const check = vi.fn(async () => true);
    const readiness = createHostReadiness({ probes: [{ name: 'identity', check }], cacheMs: 5_000, now: () => clock });
    expect(await readiness.isReady()).toBe(true);
    clock += 4_999;
    expect(await readiness.isReady()).toBe(true);
    expect(check).toHaveBeenCalledOnce();
    clock += 1;
    expect(await readiness.isReady()).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('latches not-ready on shutdown even when every probe succeeds', async () => {
    const readiness = createHostReadiness({ probes: [{ name: 'identity', check: async () => true }] });
    expect(await readiness.isReady()).toBe(true);
    readiness.markNotReady();
    expect(readiness.latched).toBe(true);
    expect(await readiness.isReady()).toBe(false);
  });
});

describe('explicit 503 while B2-B4 dependencies are absent', () => {
  it('keeps health live, readiness 503 and admission refused on both wires', async () => {
    const host = await createHostApp({ config: testConfig(), dependencies: {} });
    expect(host.pending).toEqual(['identity', 'routing', 'settlement']);

    const health = await host.app.request('/healthz');
    expect(health.status).toBe(200);
    const ready = await host.app.request('/readyz');
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'not-ready' });

    const anthropic = await host.app.request('/v1/messages', {
      ...chatRequest(false),
      body: JSON.stringify({ model: 'gpt-fixture', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(anthropic.status).toBe(503);
    expect(await anthropic.json()).toEqual({
      type: 'error', error: { type: 'overloaded_error', message: 'service temporarily unavailable' },
    });
    const openai = await host.app.request('/v1/chat/completions', chatRequest(true));
    expect(openai.status).toBe(503);
    expect(await openai.json()).toEqual({ error: {
      message: 'service temporarily unavailable', type: 'rate_limit_error', code: 'overloaded',
    } });
    const models = await host.app.request('/v1/models', { headers: { authorization: AUTHORIZATION } });
    expect(models.status).toBe(503);
  });

  it('refuses admission while any slot is pending, without calling the delivered identity port', async () => {
    const verify = vi.spyOn(fixtureCallerAuth, 'verify');
    const { dependencies } = fixtureDependencies();
    const host = await createHostApp({
      config: testConfig(), dependencies: { identity: dependencies.identity, routing: dependencies.routing },
    });
    expect(host.pending).toEqual(['settlement']);
    expect((await host.app.request('/readyz')).status).toBe(503);
    expect((await host.app.request('/v1/chat/completions', chatRequest(false))).status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();
  });

  it('becomes ready only when every delivered dependency probe succeeds', async () => {
    const host = await createHostApp({ config: testConfig(), dependencies: fixtureDependencies().dependencies });
    const ready = await host.app.request('/readyz');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ready' });
  });
});
