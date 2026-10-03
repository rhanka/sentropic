import { afterEach, describe, expect, it, vi } from 'vitest';
import * as features from '../src/native-features.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';
import { prepareRouteFlow } from '../src/route-flow-core.js';
import { createGatewayRouter } from '../src/router/index.js';
import { toProviderShapedError } from '../src/router/errors.js';
import { budgetConfig, quotingPlanner, recordingBudget } from './fixtures/budget.js';

const wire = 'anthropic-messages' as const;
const base = { model: 'claude-sonnet-5', messages: [], max_tokens: 64 };
const canonicalHeaders: Record<string, string>[] = [
  {}, { 'Anthropic-Version': '2023-06-01' }, { 'anthropic-future-feature': 'opaque' },
];
const select = (body = base as Record<string, unknown>, headers: Record<string, string> = {},
  options: Parameters<typeof features.classifyNativeFeatures>[4] = {}, ingress = wire as
  'anthropic-messages' | 'openai-chat-completions') =>
  features.classifyNativeFeatures(ingress, headers, body, normalizeGatewayIngress(ingress, body), options);
const request = (body: Record<string, unknown> = base) => ({
  wire, headers: {}, body, model: String(body.model), stream: false,
  authContext: { method: 'POST', url: 'https://gateway.test/v1/messages', requestId: 'server-id' },
});
afterEach(() => vi.restoreAllMocks());

describe('native feature classification', () => {
  it.each(canonicalHeaders)(
    'should keep version-only and unrelated Anthropic headers canonical: %j', (headers) => {
      expect(select(base, headers)).toEqual({ kind: 'none' });
    });
  it.each(['', '   ', 'unknown-beta, beta-two , future-2026-01-01']) (
    'should select a present beta without rewriting its value: %j', (beta) => {
      expect(select(base, { 'ANTHROPIC-BETA': beta, 'Anthropic-Version': 'future-version' }))
        .toEqual({ kind: 'optional', anthropicBeta: beta, anthropicVersion: 'future-version', maxOutputTokens: 64,
          forwarded: { 'anthropic-beta': beta, 'anthropic-version': 'future-version' } });
    });
  it.each([null, {}, [], false, 'provider-defined'])('should require native for own safeguards: %j', (safeguards) => {
    expect(select({ ...base, safeguards, container: {}, mcp_servers: [], unknown_extension: true }))
      .toMatchObject({ kind: 'required', maxOutputTokens: 64 });
  });
  it('should ignore inherited safeguards and nested content safeguards', () => {
    expect(select(Object.assign(Object.create({ safeguards: {} }), base))).toEqual({ kind: 'none' });
    expect(select({ ...base, messages: [{ role: 'user', content: [{ safeguards: {} }] }] }))
      .toEqual({ kind: 'none' });
  });
  it('should impose no beta token, feature name or custom header-size limits', () => {
    const beta = Array.from({ length: 200 }, (_, i) => `unknown-${i}-2026-01-01`).join(', ');
    expect(select(base, { 'anthropic-beta': beta, 'anthropic-future': 'x'.repeat(8192) }))
      .toMatchObject({ kind: 'optional', anthropicBeta: beta });
  });
  it('should use the budget default only when no explicit effective ceiling exists', () => {
    const budget = recordingBudget(undefined, { defaultOutputTokens: 4096 }).options;
    expect(select({ model: base.model, messages: [], safeguards: null }, {}, { budget }))
      .toMatchObject({ kind: 'required', maxOutputTokens: 4096 });
    expect(select({ ...base, safeguards: {} }, {}, { budget })).toMatchObject({ maxOutputTokens: 64 });
  });
  it.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'should keep optional traffic canonical and refuse unbounded required traffic: %j', (max_tokens) => {
      const body = { ...base, max_tokens };
      expect(select(body, { 'anthropic-beta': '' })).toEqual({ kind: 'none' });
      expect(() => select({ ...body, safeguards: {} })).toThrow(expect.objectContaining({ kind: 'native-max-tokens-required' }));
      expect(() => select({ ...body, safeguards: {} }, {}, { budget: recordingBudget().options }))
        .toThrow(expect.objectContaining({ kind: 'bad-request' }));
    });
  it('should preserve explicit OFF precedence over ceiling and unknown-model lookup', async () => {
    const { planner, calls } = quotingPlanner([]); const recorder = recordingBudget();
    await expect(prepareRouteFlow({ config: budgetConfig, routePlanner: planner, metering: recorder.metering,
      budget: recorder.options, nativeMessagesEnabled: false }, request({ ...base, model: 'unknown', max_tokens: 0, safeguards: null })))
      .rejects.toMatchObject({ kind: 'native-required' });
    expect(calls.quote).toEqual([]); expect(calls.plan).toEqual([]); expect(recorder.events).toEqual([]);
    expect(select(base, { 'anthropic-beta': '' }, { nativeMessagesEnabled: false })).toEqual({ kind: 'none' });
  });
  it('should keep OpenAI headers canonical and refuse OpenAI safeguards with its own envelope', () => {
    expect(select(base, { 'anthropic-beta': '' }, {}, 'openai-chat-completions')).toEqual({ kind: 'none' });
    let error: unknown;
    try { select({ ...base, safeguards: {} }, {}, {}, 'openai-chat-completions'); } catch (caught) { error = caught; }
    expect(toProviderShapedError('openai-chat-completions', error)).toEqual({ status: 400,
      body: { error: { type: 'invalid_request_error', code: 'invalid_request',
        message: 'safeguards requires the Anthropic Messages endpoint.' } } });
  });
  it.each(['anthropic-beta', 'ANTHROPIC-VERSION'])('should refuse required and fall back optional on nominated markers: %s', (name) => {
    const headers = { Connection: `keep-alive, ${name}`, 'anthropic-beta': 'opaque', 'anthropic-version': '2023-06-01' };
    expect(select(base, headers)).toEqual({ kind: 'none' });
    expect(() => select({ ...base, safeguards: {} }, headers)).toThrow(expect.objectContaining({ kind: 'native-required' }));
  });
  it('should classify exactly once before budget admission and carry selection into the prepared flow', async () => {
    const classify = vi.spyOn(features, 'classifyNativeFeatures');
    const recorder = recordingBudget(undefined, { defaultOutputTokens: 4096 }); const { planner } = quotingPlanner([]);
    const prepared = await prepareRouteFlow({ config: budgetConfig, routePlanner: planner,
      metering: recorder.metering, budget: recorder.options }, request({ model: base.model, messages: [] }));
    expect(classify).toHaveBeenCalledTimes(1); expect(prepared.nativeFeatures).toEqual({ kind: 'none' });
    expect(prepared.canonical.request.maxOutputTokens).toBe(4096);
    expect(recorder.events).toEqual(['admit']);
  });
  it('should authenticate before classification and avoid settlement for caller denial', async () => {
    const classify = vi.spyOn(features, 'classifyNativeFeatures'); const recorder = recordingBudget();
    const { planner, calls } = quotingPlanner([]);
    await expect(prepareRouteFlow({ config: { ...budgetConfig, callerAuth: { verify: async () => ({ ok: false }) } },
      routePlanner: planner, metering: recorder.metering }, request({ ...base, safeguards: {} })))
      .rejects.toMatchObject({ kind: 'caller-auth-failed' });
    expect(classify).not.toHaveBeenCalled(); expect(calls.plan).toEqual([]); expect(recorder.events).toEqual([]);
  });
  it.each([false, true])('should carry required selection through both budget modes: %s', async (admitted) => {
    const classify = vi.spyOn(features, 'classifyNativeFeatures'); const recorder = recordingBudget();
    const { planner } = quotingPlanner([]);
    const prepared = await prepareRouteFlow({ config: budgetConfig, routePlanner: planner,
      metering: recorder.metering, ...(admitted ? { budget: recorder.options } : {}) }, request({ ...base, safeguards: null }));
    expect(classify).toHaveBeenCalledTimes(1);
    expect(prepared.nativeFeatures).toMatchObject({ kind: 'required', maxOutputTokens: 64 });
    expect(recorder.events).toEqual(admitted ? ['admit'] : []);
  });
  it('should return the exact standalone OFF refusal without retry or relay headers', async () => {
    const recorder = recordingBudget(); const { planner, calls } = quotingPlanner([]);
    const app = createGatewayRouter({ config: budgetConfig, routePlanner: planner,
      routeMetering: recorder.metering, nativeMessagesEnabled: false, requestId: () => 'server-id' });
    const response = await app.request('/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, safeguards: null }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error',
      message: 'safeguards is not supported by this gateway route; retry without safeguards.' } });
    expect(response.headers.get('x-sentropic-request-id')).toBe('server-id');
    expect(response.headers.get('retry-after')).toBeNull(); expect(response.headers.get('x-sentropic-relay')).toBeNull();
    expect(calls.plan).toEqual([]); expect(recorder.events).toEqual([]);
  });
});
