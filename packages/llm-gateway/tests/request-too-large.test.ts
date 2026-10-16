import { describe, expect, it, vi } from 'vitest';
import { NativeMessagesUpstreamError, normalizeProviderError, RequestTooLargeError,
  type RequestSizeDetail } from '@sentropic/llm-mesh';
import type { GatewayWire } from '../src/ports/dispatch.js';
import { defaultGatewayBodyBytePool, toProviderShapedError } from '../src/index.js';
import { classifyRouteError } from '../src/route-flow-core.js';
import { budgetRouter, jsonAttempt, quotingPlanner, recordingBudget, send, textResponse } from './fixtures/budget.js';
import { nativeHarness, nativeChunks, nativeFrame, sendNative } from './fixtures/native-flow.js';

// N02 wire contract slice: numeric 413 envelopes on every wire. Flow-level
// pre-byte mapping and terminal propagation land in N09 (same file extended).
const WIRES: readonly GatewayWire[] = ['anthropic-messages', 'openai-chat-completions', 'openai-responses'];

describe.each(WIRES)('numeric 413 public contract on %s', (wire) => {
  it.each([
    [{ requestBytes: 32000001, limitBytes: 32000000, source: 'gateway' }, 'Request size 32000001 bytes exceeds limit 32000000 bytes.'],
    [{ requestBytes: 32000002, limitBytes: 32000000, source: 'gateway', sizeIsLowerBound: true }, 'Request size is at least 32000002 bytes and exceeds limit 32000000 bytes.'],
    [{ requestBytes: 127, source: 'upstream' }, 'Request size 127 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 127, limitBytes: 32000000, source: 'upstream' }, 'Request size 127 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 32000000, limitBytes: 32000000, source: 'upstream' }, 'Request size 32000000 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 0, source: 'upstream' }, 'Request size 0 bytes was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
    [{ requestBytes: 127, source: 'upstream', sizeIsLowerBound: true }, 'Request size is at least 127 bytes and was rejected as too large upstream; gateway limit is 32000000 bytes and the upstream rejecting limit is unavailable.'],
  ] as const)('uses only measured numeric evidence: %j', (requestSize, message) => {
    const error = new NativeMessagesUpstreamError({ status: 413, type: 'request_too_large', requestSize });
    for (const wrapped of [error, normalizeProviderError('anthropic', error), { cause: error }]) {
      const mapped = toProviderShapedError(wire, wrapped);
      expect(mapped.status).toBe(413);
      expect(mapped.headers).toEqual({ 'x-should-retry': 'false' });
      expect(mapped.body).toEqual(wire === 'anthropic-messages'
        ? { type: 'error', error: { type: 'request_too_large', message } }
        : { error: { type: 'invalid_request_error', code: 'request_too_large', message } });
    }
  });
  const size: RequestSizeDetail = { requestBytes: 7, source: 'upstream' };
  it.each([
    { status: 413, code: 'auth_rate_overloaded', retryAfterMs: 10000, requestSize: size },
    { statusCode: 413, requestSize: size }, { code: 'request_too_large', requestSize: size },
    { type: 'request_too_large', requestSize: size },
    { status: 503, cause: new RequestTooLargeError(size) },
  ])('classifies before auth/rate/overload and preserves status: %j', error => {
    expect(classifyRouteError(error)).toEqual({ reason: 'invalid-request', retryable: false, healthScope: 'route' });
    expect(classifyRouteError(error, true)).toEqual({ reason: 'cancelled', retryable: false, healthScope: 'route' });
    expect(toProviderShapedError(wire, error).status).toBe(413);
  });
  it('does not invent numbers from provider prose or malformed metadata', () => {
    const mapped = toProviderShapedError(wire, { status: 413, message: 'SECRET size 999999 limit 1',
      requestSize: { requestBytes: 10.5, limitBytes: 1, source: 'upstream' } });
    expect(mapped.status).toBe(413);
    expect(JSON.stringify(mapped.body)).not.toMatch(/SECRET|999999|exceeds/);
    expect(JSON.stringify(mapped.body)).toContain('Request size is unavailable');
  });
});

// N09 flow slices: terminal 413 across route flows on all three wires, then
// the shared legacy passthrough (request-too-large-legacy.test.ts). The
// native HTTP/SSE 413 stays N22 (request-too-large-http.test.ts).
const rejectionModes = ['none', 'outcome', 'settlement', 'both'] as const;
const size: RequestSizeDetail = { requestBytes: 32000001, limitBytes: 32000000, source: 'gateway' };
const errorForms = [new RequestTooLargeError(size), { status: 413, code: 'auth_rate_overloaded', requestSize: size },
  { code: 'request_too_large', requestSize: size }, { cause: normalizeProviderError('anthropic', new RequestTooLargeError(size)) }];
const verifyRefusal = async (response: Response) => {
  expect(response.status).toBe(413); expect(response.headers.get('x-should-retry')).toBe('false');
  expect(response.headers.has('retry-after')).toBe(false); expect(response.headers.has('x-sentropic-relay')).toBe(false);
  expect((await response.json()).error.message).toBe('Request size 32000001 bytes exceeds limit 32000000 bytes.');
};

const wireSend = (
  app: ReturnType<typeof budgetRouter>, wire: GatewayWire, path: string, stream: boolean,
): Promise<Response> => {
  if (wire !== 'openai-responses') return send(app, path, stream);
  // Budget admission prices Responses from its output ceiling (pre-existing rule).
  return Promise.resolve(app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-6.1-sol', input: 'hello', max_output_tokens: 64,
      ...(stream ? { stream: true } : {}) }) }));
};

describe.each([
  { wire: 'anthropic-messages' as const, path: '/v1/messages' },
  { wire: 'openai-chat-completions' as const, path: '/v1/chat/completions' },
  { wire: 'openai-responses' as const, path: '/v1/responses' },
])('canonical terminal 413 on $wire', ({ wire, path }) => {
  it.each(['json', 'stream-open', 'stream-event'] as const)('keeps %s terminal across error shapes and callback failures', async mode => {
    for (const error of errorForms) for (const rejection of rejectionModes) {
      const first = jsonAttempt(vi.fn(async () => { throw error; }));
      const closed = vi.fn();
      first.stream = vi.fn(async () => {
        if (mode === 'stream-open') throw error;
        return (async function* () {
          try {
            yield { type: 'status' as const, data: { status: 'started' as const } };
            yield { type: 'error' as const, data: normalizeProviderError('anthropic', error) };
          } finally { closed(); }
        })();
      });
      const next = jsonAttempt(vi.fn(async () => { throw Error('second candidate forbidden'); }));
      const { planner, calls } = quotingPlanner([first, next]);
      const recorder = recordingBudget();
      const settle = recorder.metering.settleRoute;
      const sink = vi.fn(async (value: Parameters<typeof settle>[0]) => {
        await settle(value); if (rejection === 'settlement' || rejection === 'both') throw Error('sink unavailable');
      });
      recorder.metering.settleRoute = sink;
      const outcome = vi.spyOn(first, 'recordOutcome');
      if (rejection === 'outcome' || rejection === 'both') outcome.mockRejectedValue(Error('outcome unavailable'));
      await verifyRefusal(await wireSend(budgetRouter({ planner, recorder }), wire, path, mode !== 'json'));
      expect(calls.prepare).toEqual([0]); expect(next.generate).not.toHaveBeenCalled();
      expect(outcome.mock.calls[0]![0]).toEqual({ reason: 'invalid-request', retryable: false, healthScope: 'route' });
      expect(outcome).toHaveBeenCalledTimes(1); expect(sink).toHaveBeenCalledTimes(1);
      expect(recorder.settlements[0]!.attempts).toHaveLength(1);
      if (mode === 'stream-event') expect(closed).toHaveBeenCalledTimes(1);
    }
  });
});

it.each(['json', 'stream-open', 'stream-frame'] as const)('keeps native %s 413 terminal with no canonical fallback', async mode => {
  for (const rejection of rejectionModes) {
    const h = nativeHarness({ execute: async () => {
      if (mode !== 'stream-frame') throw new NativeMessagesUpstreamError({ status: 413, requestSize: size });
      return { kind: 'stream', status: 200, headers: {}, requestSize: size,
        body: nativeChunks([nativeFrame('error', { error: { type: 'request_too_large', message: 'PRIVATE auth rate' } })]) };
    } });
    const plan = h.deps.routePlanner.plan;
    h.deps.routePlanner.plan = async (...args) => {
      const value = await plan(...args);
      return { ...value, candidateRefs: ['candidate-0', 'candidate-1'],
        diagnostics: [value.diagnostics[0]!, { ...value.diagnostics[0]!, candidateRef: 'candidate-1' }] };
    };
    const prepare = vi.fn(async () => h.attempt); h.deps.routePlanner.prepareAttempt = prepare;
    if (rejection === 'outcome' || rejection === 'both') h.attempt.recordOutcome.mockRejectedValue(Error('outcome unavailable'));
    const settle = h.recorder.metering.settleRoute;
    const sink = vi.fn(async (value: Parameters<typeof settle>[0]) => {
      await settle(value); if (rejection === 'settlement' || rejection === 'both') throw Error('sink unavailable');
    });
    h.recorder.metering.settleRoute = sink;
    await verifyRefusal(await sendNative(h, mode !== 'json'));
    expect(prepare).toHaveBeenCalledTimes(1); expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.attempt.generate).not.toHaveBeenCalled(); expect(h.attempt.markCommitted).not.toHaveBeenCalled();
    expect(h.finalize).toHaveBeenCalledTimes(1); expect(sink).toHaveBeenCalledTimes(1);
    expect(h.recorder.settlements[0]!.attempts).toHaveLength(1);
    expect(h.recorder.settlements[0]!.usage).toMatchObject({ inputTokens: 10000, outputTokens: 32000, estimated: true });
  }
});

describe('terminal mid-read transport 413', () => {
  it('maps a typed reader refusal to 413 and restores pool bytes', async () => {
    const { planner } = quotingPlanner([jsonAttempt(textResponse())]);
    const recorder = recordingBudget();
    const app = budgetRouter({ planner, recorder, budget: false });
    const refusal = new RequestTooLargeError({ requestBytes: 9, limitBytes: 8, source: 'gateway' });
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      reads += 1;
      if (reads === 1) controller.enqueue(new TextEncoder().encode('{"a":'));
      else controller.error(refusal);
    } });
    const response = await app.request('/v1/messages', { method: 'POST', body: body as unknown as BodyInit,
      duplex: 'half' } as RequestInit & { duplex: 'half' });
    expect(response.status).toBe(413);
    expect((await response.json()).error.message).toBe('Request size 9 bytes exceeds limit 8 bytes.');
    expect(response.headers.get('x-should-retry')).toBe('false');
    expect(defaultGatewayBodyBytePool.stats).toMatchObject({ reservedBytes: 0, liveLeases: 0 });
  });
});
