import { describe, expect, it } from 'vitest';
import { encodeOpenAiDecisionsRequest, decodeOpenAiDecisionsResponse } from '../src/decision/openai-codec.js';
import { openAiDecisionsDescriptor } from '../src/decision/openai-descriptor.js';
import { decisionRequest } from './decision-fixtures.js';

export const openAiFixtureDescriptor = () => ({ ...structuredClone(openAiDecisionsDescriptor),
  acceptedServedModelIds: ['gpt-6-luna'], qualification: { servedIdentity: 'qualified' as const,
    billingBound: 'qualified' as const, evidenceRefs: ['fixture:openai-only'] } });
export const openAiFixtureResponse = (answer: unknown = { type: 'predicate', name: 'verdict', probability: 0 }) => ({
  model: 'gpt-6-luna', answers: [answer], usage: { input_tokens: 1000, output_tokens: 0, total_tokens: 1000,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
});
const request = () => decisionRequest({ evaluator: openAiFixtureDescriptor().evaluator });
const decode = (body: unknown, req = request()) => decodeOpenAiDecisionsResponse(body, req, openAiFixtureDescriptor());

describe('P24 OpenAI Decisions native wire contract (synthetic documented fixtures)', () => {
  it('should encode one named predicate with separate evidence and no implicit cache', () => {
    const result = encodeOpenAiDecisionsRequest(request(), openAiFixtureDescriptor());
    expect(result.ok && JSON.parse(result.bodyJson)).toEqual({ model: 'gpt-6-luna', input: JSON.stringify(request().inputs),
      questions: [{ type: 'predicate', name: 'verdict', instructions: 'Check evidence.' }],
      prompt_cache_options: { mode: 'explicit' } });
  });
  it('should preserve zero, null no-rule and a successful negative threshold decision', () => {
    expect(decode(openAiFixtureResponse())).toMatchObject({ ok: true, verdict: { score: { value: 0 },
      decision: null, confidence: null, rationale: null, distribution: null } });
    expect(decode(openAiFixtureResponse(), { ...request(), decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } }))
      .toMatchObject({ ok: true, verdict: { decision: { pass: false, origin: 'threshold' } } });
  });
  it.each([
    [], [{ type: 'predicate', probability: 0.2 }], [{ type: 'predicate', name: 'foreign', probability: 0.2 }],
    [{ type: 'predicate', name: null, probability: 0.2 }],
    Array(2).fill({ type: 'predicate', name: 'verdict', probability: 0.2 }),
    [{ type: 'score', name: 'verdict', probability: 0.2 }],
    [{ type: 'predicate', name: 'verdict', probability: false }],
    [{ type: 'predicate', name: 'verdict', probability: 0.2, canary: 'extra' }],
  ].map((answers) => [answers]))('should reject independent name/count/type corruption: %j', (answers) => {
    expect(decode({ ...openAiFixtureResponse(), answers })).toMatchObject({ ok: false, error: { code: 'VERDICT_INVALID' },
      usage: { tokens: { input: { value: 1000, source: 'provider' } } } });
  });
  it('should map refusal to a typed non-evaluation while retaining usage', () => {
    expect(decode(openAiFixtureResponse({ type: 'refusal', name: 'verdict' }))).toMatchObject({ ok: false,
      error: { code: 'PROVIDER_REJECTED' }, usage: { tokens: { input: { value: 1000 } } } });
  });
  it.each([null, 'foreign-model', 'bad model', 17])('should reject independently served model %j', (model) => {
    expect(decode({ ...openAiFixtureResponse(), model })).toMatchObject({ ok: false,
      error: { code: 'SERVED_IDENTITY_MISMATCH' }, usage: { tokens: { input: { value: 1000 } } } });
  });
  it.each([{ input_tokens: -1 }, { output_tokens: null }, { total_tokens: 2 },
    { input_tokens_details: { cached_tokens: 1001, cache_write_tokens: 0 } },
    { output_tokens_details: { reasoning_tokens: 1 } }])('should reject malformed usage independently: %j', (change) => {
    const body = openAiFixtureResponse();
    expect(decode({ ...body, usage: { ...body.usage, ...change } })).toMatchObject({ ok: false, error: { code: 'USAGE_INVALID' } });
  });
  it('should accept tied string choices and reject boolean values without coercion', () => {
    const req = { ...request(), criterion: { kind: 'choice' as const, instructions: 'Route.', options: [
      { id: 'true', description: 'One' }, { id: 'false', description: 'Two' }] } };
    const answer = { type: 'choice', name: 'verdict', choice: 'false', confidence: 0.8,
      probabilities: [{ value: 'true', probability: 0.5 }, { value: 'false', probability: 0.5 }] };
    expect(decode(openAiFixtureResponse(answer), req)).toMatchObject({ ok: true, verdict: { label: { value: 'false' } } });
    expect(decode(openAiFixtureResponse({ ...answer, choice: false }), req).ok).toBe(false);
    expect(decode(openAiFixtureResponse({ ...answer, probabilities: [{ value: true, probability: 0.5 },
      { value: 'false', probability: 0.5 }] }), req).ok).toBe(false);
  });
  it('should bind graded index, label and expectation independently', () => {
    const req = { ...request(), criterion: { kind: 'graded' as const, instructions: 'Grade.', direction: 'lower-is-better' as const,
      levels: [{ label: 'low', description: 'Low' }, { label: 'high', description: 'High' }] } };
    const answer = { type: 'score', name: 'verdict', score: 0.75, confidence: 0.8,
      probabilities: [{ value: 1, label: 'high', probability: 0.75 }, { value: 0, label: 'low', probability: 0.25 }] };
    expect(decode(openAiFixtureResponse(answer), req)).toMatchObject({ ok: true,
      verdict: { score: { value: 0.75, scale: { direction: 'lower-is-better' } } } });
    for (const bad of [{ ...answer, score: 0.5 }, { ...answer, probabilities: [answer.probabilities[0], answer.probabilities[0]] },
      { ...answer, probabilities: [{ ...answer.probabilities[0], label: 'low' }, answer.probabilities[1]] }]) {
      expect(decode(openAiFixtureResponse(bad), req).ok).toBe(false);
    }
  });
});
