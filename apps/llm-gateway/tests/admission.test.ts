// Lot D B3c: the standalone host always runs budget admission and the D2 partition before any
// account acquisition. Fixture ports only; the real Postgres adapter is covered by the API test
// `api/tests/api/llm-budget-ledger.test.ts`, which also composes this host over the ledger.
import { describe, expect, it, vi } from 'vitest';
import type { BudgetAdmissionPort } from '@sentropic/llm-gateway';

import { createHostApp } from '../src/app';
import {
  AUTHORIZATION, chatRequest, fixtureDependencies, fixturePartition, fixturePartitionSource, gatedStream, testConfig,
} from './fixtures';

const messages = (stream: boolean): RequestInit => ({
  method: 'POST',
  headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-fixture', stream, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
});

const hostWith = async (patch: (dependencies: ReturnType<typeof fixtureDependencies>['dependencies']) => object) => {
  const stream = gatedStream();
  const fixture = fixtureDependencies(stream.stream);
  const host = await createHostApp({ config: testConfig(), dependencies: { ...fixture.dependencies, ...patch(fixture.dependencies) } });
  return { ...fixture, stream: stream.stream, app: host.app };
};

const budgetPort = (decision: Awaited<ReturnType<BudgetAdmissionPort['admit']>>) => ({
  admit: vi.fn(async () => decision), markDispatched: vi.fn(async () => {}), release: vi.fn(async () => {}),
});

describe('standalone host budget admission', () => {
  it.each([
    ['openai JSON', '/v1/chat/completions', chatRequest(false)],
    ['openai SSE', '/v1/chat/completions', chatRequest(true)],
    ['anthropic JSON', '/v1/messages', messages(false)],
    ['anthropic SSE', '/v1/messages', messages(true)],
  ])('refuses %s over budget with 429 before any acquisition or settlement', async (_name, path, init) => {
    const port = budgetPort({ kind: 'over-budget', resetAtMs: Date.now() + 30 * 86_400_000 });
    const f = await hostWith(() => ({ budget: { port, ready: async () => true, defaultOutputTokens: 1_024 } }));
    const response = await f.app.request(path, init);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('content-type')).not.toContain('text/event-stream');
    expect(port.admit).toHaveBeenCalledOnce();
    expect(port.markDispatched).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.settlements).toEqual([]);
  });

  it('answers the sanitized 503 (never 429, never a free request) when the budget store is unavailable', async () => {
    const port = budgetPort({ kind: 'unavailable' });
    const f = await hostWith(() => ({ budget: { port, ready: async () => true, defaultOutputTokens: 1_024 } }));
    const response = await f.app.request('/v1/chat/completions', chatRequest(false));
    expect(response.status).toBe(503);
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.settlements).toEqual([]);
  });

  it('reports not-ready while the budget or ledger store probe fails', async () => {
    const f = await hostWith((dependencies) => ({ budget: { ...dependencies.budget!, ready: async () => { throw new Error('down'); } } }));
    expect((await f.app.request('/readyz')).status).toBe(503);
  });
});

describe('standalone host D2 partition', () => {
  it('refuses an identity assigned to the product /gw (chat and models) before budget or dispatch', async () => {
    const port = budgetPort({ kind: 'admitted', holdRef: 'hold-1' });
    const partition = { source: fixturePartitionSource(fixturePartition({ 'tenant-1': { product: ['user-1'] } })) };
    const f = await hostWith(() => ({ budget: { port, ready: async () => true, defaultOutputTokens: 1_024 }, partition }));
    expect((await f.app.request('/v1/chat/completions', chatRequest(false))).status).toBe(401);
    expect((await f.app.request('/v1/models', { headers: { authorization: AUTHORIZATION } })).status).toBe(401);
    expect(port.admit).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect((await f.app.request('/readyz')).status).toBe(200);
  });

  it.each([
    ['an overlapping assignment', () => fixturePartitionSource(fixturePartition({ 'tenant-1': { product: ['user-1'], standalone: ['user-1'] } }))],
    ['a revision hash mismatch', () => ({ load: () => fixturePartition(), expected: () => ({ revision: 'fixture-r1', hash: 'other' }) })],
    ['a revision id mismatch', () => ({ load: () => fixturePartition(), expected: () => ({ revision: 'fixture-r0', hash: fixturePartition().hash }) })],
    ['tampered assignments', () => {
      const config = { ...fixturePartition(), tenants: { 'tenant-1': { standalone: ['user-1', 'user-2'] } } };
      return { load: () => config, expected: () => ({ revision: config.revision, hash: config.hash }) };
    }],
    ['a missing configuration', () => ({ load: () => undefined, expected: () => undefined })],
  ])('fails closed (503, not ready) on %s', async (_name, source) => {
    const f = await hostWith(() => ({ partition: { source: source() } }));
    expect((await f.app.request('/v1/chat/completions', chatRequest(false))).status).toBe(503);
    expect((await f.app.request('/readyz')).status).toBe(503);
    expect(f.generate).not.toHaveBeenCalled();
  });
});
