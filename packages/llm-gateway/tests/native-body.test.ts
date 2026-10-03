import { describe, expect, it } from 'vitest';
import { buildNativeMessagesBody } from '../src/route-native.js';
import { normalizeGatewayIngress } from '../src/canonical-ingress.js';
import { boundRouteOutputCeiling, routeUsageCeiling } from '../src/admission.js';
import { classifyNativeFeatures } from '../src/native-features.js';
import { recordingBudget } from './fixtures/budget.js';

const dispatch = { model: 'claude-sonnet-5', stream: true, maxOutputTokens: 64 };

describe('native body construction', () => {
  it('should copy only the top level and preserve every nested opaque provider field', () => {
    const body = Object.freeze({
      model: 'caller-model', stream: false, max_tokens: 128,
      messages: Object.freeze([{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', data: 'AA==' } },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BB==' } },
        { type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'opaque' }] },
      ] }]),
      system: Object.freeze([{ type: 'text', text: 'system', cache_control: { type: 'ephemeral', ttl: '1h' } }]),
      safeguards: Object.freeze({ classifier_context: ['opaque'] }), container: Object.freeze({ id: 'provider-container' }),
      mcp_servers: Object.freeze([{ type: 'url', url: 'https://example.test/mcp' }]),
      tools: Object.freeze([{ name: 'tool', input_schema: { type: 'object' } }]),
      metadata: Object.freeze({ user_id: 'provider-user' }), unknown_extension: Object.freeze({ nested: [2, 1, null] }),
      ownerScopeRef: 'caller-owner', authorization: 'caller-body-value', nativeInputPriceUnits40: 123,
    });
    const before = JSON.stringify(body); const result = buildNativeMessagesBody(body, dispatch);
    expect(result).not.toBe(body);
    expect(result).toEqual({ ...body, model: dispatch.model, stream: true, max_tokens: 64 });
    for (const key of ['messages', 'system', 'safeguards', 'container', 'mcp_servers', 'tools', 'metadata', 'unknown_extension'] as const) {
      expect(result[key]).toBe(body[key]);
    }
    expect(JSON.stringify(body)).toBe(before);
    expect(body.model).toBe('caller-model'); expect(body.stream).toBe(false); expect(body.max_tokens).toBe(128);
  });
  it.each([null, {}, []])('should forward provider-defined safeguards unchanged: %j', (safeguards) => {
    const result = buildNativeMessagesBody({ safeguards }, dispatch);
    expect(result.safeguards).toBe(safeguards);
    expect(result.max_tokens).toBe(64);
  });
  it.each([[16, 16], [64, 64], [128, 64]])('should bound a valid caller ceiling %i to %i without increasing it', (supplied, sent) => {
    const body = Object.freeze({ max_tokens: supplied });
    expect(buildNativeMessagesBody(body, dispatch).max_tokens).toBe(sent);
    expect(body.max_tokens).toBe(supplied);
  });
  it.each([undefined, null, '64', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'should refuse a supplied malformed ceiling instead of replacing it: %j', (max_tokens) => {
      expect(() => buildNativeMessagesBody({ max_tokens }, dispatch))
        .toThrow(expect.objectContaining({ kind: 'bad-request' }));
    });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('should reject an invalid reserved ceiling: %j', (maxOutputTokens) => {
    expect(() => buildNativeMessagesBody({}, { ...dispatch, maxOutputTokens }))
      .toThrow(expect.objectContaining({ kind: 'bad-request' }));
  });
  it.each([null, [], 'not-object'])('should reject a non-object native body: %j', (body) => {
    expect(() => buildNativeMessagesBody(body, dispatch)).toThrow(expect.objectContaining({ kind: 'bad-request' }));
  });
  it('should validate trusted dispatch model and stream fields before building a body', () => {
    expect(() => buildNativeMessagesBody({}, { ...dispatch, model: ' ' })).toThrow();
    expect(() => buildNativeMessagesBody({}, { ...dispatch, stream: 'true' as unknown as boolean })).toThrow();
  });
  it.each([undefined, 32])('should match the explicit or budget-default native ceiling: %j', (max_tokens) => {
    const body = Object.freeze({ model: dispatch.model, messages: [], safeguards: null,
      max_completion_tokens: 9999, ...(max_tokens !== undefined ? { max_tokens } : {}) });
    const budget = recordingBudget(undefined, { defaultOutputTokens: 4096 }).options;
    const canonical = normalizeGatewayIngress('anthropic-messages', body);
    const native = classifyNativeFeatures('anthropic-messages', {}, body, canonical, { budget });
    if (native.kind === 'none') throw new Error('expected required native selection');
    const ceiling = routeUsageCeiling(boundRouteOutputCeiling(canonical, budget), budget);
    expect(native.maxOutputTokens).toBe(max_tokens ?? 4096);
    expect(ceiling.outputTokens).toBe(native.maxOutputTokens);
    const outbound = buildNativeMessagesBody(body, { ...dispatch, maxOutputTokens: ceiling.outputTokens });
    expect(outbound.max_tokens).toBe(ceiling.outputTokens);
    expect(outbound.max_completion_tokens).toBe(9999);
    expect(Object.hasOwn(body, 'max_tokens')).toBe(max_tokens !== undefined);
  });
});
