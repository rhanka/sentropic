import { describe, expect, it } from 'vitest';
import { isBoundedJson, isCorrelationId, isMicroUsd } from '../src/decision/validation.js';
import { isDecisionCriterion, isDecisionRule } from '../src/decision/criterion.js';
import { parseDecisionRequest } from '../src/decision/request.js';

describe('decision request JSON boundary', () => {
  it('should preserve valid JSON and reject values JSON would silently coerce', () => {
    expect(isBoundedJson({ output: null, state: [0, false, 'text'] })).toBe(true);
    for (const value of [NaN, Infinity, undefined, 1n, new Date(), [undefined], Array(1)]) {
      expect(isBoundedJson(value)).toBe(false);
    }
    const hidden = Array(1);
    hidden[4_294_967_295] = 'must not disappear';
    expect(isBoundedJson(hidden)).toBe(false);
  });
  it('should reject unsafe keys and accessors without invoking user code', () => {
    expect(isBoundedJson(JSON.parse('{"state":{"__proto__":{}}}'))).toBe(false);
    expect(isBoundedJson({ get output() { throw new Error('must not run'); } })).toBe(false);
    expect(isBoundedJson({ [Symbol('hidden')]: 'value' })).toBe(false);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(isBoundedJson({ output: { [key]: 'Code symbol' } })).toBe(false);
    }
  });
  it('should bound UTF-8 bytes, canonical money and correlation identifiers', () => {
    expect(isBoundedJson('é', 4)).toBe(true);
    expect(isBoundedJson('é', 3)).toBe(false);
    expect(['0', '42', '9007199254740993'].every(isMicroUsd)).toBe(true);
    expect(['01', '-1', '1.0', ' 1', '1e3'].some(isMicroUsd)).toBe(false);
    expect(isCorrelationId('call:one-1.2_3')).toBe(true);
    expect(isCorrelationId('a'.repeat(129))).toBe(false);
    expect(isCorrelationId('line\nbreak')).toBe(false);
  });
  it('should copy and inspect symbols from one descriptor-key snapshot', () => {
    let reads = 0;
    const value = new Proxy({ output: null }, {
      ownKeys(target) { reads++; return Reflect.ownKeys(target); },
    });
    expect(isBoundedJson(value)).toBe(true);
    expect(reads).toBe(1);
  });
  it('should bound work when shared references expand into a larger JSON tree', () => {
    let visits = 0;
    const leaf = new Proxy({ text: 'Synthetic' }, {
      ownKeys(target) { visits++; return Reflect.ownKeys(target); },
    });
    let graph: unknown = leaf;
    for (let i = 0; i < 10; i++) graph = [graph, graph];
    expect(isBoundedJson(graph, 32)).toBe(false);
    expect(visits).toBeLessThanOrEqual(32);
  });
});

const request = () => ({ schemaVersion: 1,
  evaluator: { providerId: 'openai', evaluatorId: 'synthetic', revision: 'v1' },
  inputs: { output: null, state: { text: 'Synthetic content' } },
  criterion: { kind: 'binary', instructions: 'Check supplied state' } });

describe('strict decision request parsing', () => {
  it.each([{ output: null }, { state: null }, { output: null, state: null }])(
    'should accept explicit null candidate values without adding absent fields: %j', (inputs) => {
      const candidate = { ...request(), inputs };
      expect(parseDecisionRequest(candidate)).toStrictEqual({ ok: true, request: candidate });
    });
  it.each([{}, { input: null }, { reference: null }, { output: undefined }, { state: undefined },
    { output: undefined, state: undefined }, { output: null, state: undefined }, { output: undefined, state: null }])(
    'should refuse absent candidates or undefined fields rather than treating them as null: %j', (inputs) => {
      expect(parseDecisionRequest({ ...request(), inputs })).toEqual({ ok: false, code: 'REQUEST_INVALID' });
    });
  it('should refuse an absent or undefined inputs envelope', () => {
    const { inputs: _inputs, ...candidate } = request();
    expect(parseDecisionRequest(candidate)).toEqual({ ok: false, code: 'REQUEST_INVALID' });
    expect(parseDecisionRequest({ ...candidate, inputs: undefined })).toEqual({ ok: false, code: 'REQUEST_INVALID' });
  });
  it('should retain significant null inputs and snapshot data without inventing defaults', () => {
    const input = request();
    const result = parseDecisionRequest(input);
    input.inputs.state.text = 'Changed';
    expect(result).toEqual({ ok: true, request: request() });
  });
  it('should return only validated content when a proxy changes later serialization', () => {
    let serializations = 0;
    const candidate = new Proxy(request(), {
      get(target, key, receiver) {
        if (key === 'toJSON') return () => ++serializations === 1 ? target
          : { ...target, endpoint: 'https://synthetic.invalid' };
        return Reflect.get(target, key, receiver);
      },
    });
    expect(parseDecisionRequest(candidate)).toEqual({ ok: true, request: request() });
  });
  it('should refuse caller credentials, endpoints, fan-out and tenant selectors', () => {
    for (const key of ['auth', 'endpoint', 'fallback', 'batch', 'tenantId']) {
      expect(parseDecisionRequest({ ...request(), [key]: 'dummy' })).toEqual({ ok: false, code: 'REQUEST_INVALID' });
    }
    expect(parseDecisionRequest({ ...request(), policy: { zdr: true }, fallback: [] })).toEqual({ ok: false, code: 'CAPABILITY_UNSUPPORTED' });
    expect(parseDecisionRequest({ ...request(), policy: { zdr: true } })).toEqual({ ok: false, code: 'CAPABILITY_UNSUPPORTED' });
    expect(parseDecisionRequest({ ...request(), inputs: { input: 'No candidate' } }).ok).toBe(false);
    expect(parseDecisionRequest({ ...request(), evaluator: { ...request().evaluator, providerId: 'unknown' } })).toEqual({ ok: false, code: 'PROVIDER_UNKNOWN' });
  });
  it.each([
    { schemaVersion: 2 },
    { evaluator: { ...request().evaluator, endpoint: 'dummy' } },
    { inputs: { output: 'Candidate', context: 'not-an-array' } },
    { criterion: { kind: 'graded', instructions: 'Grade', levels: [{ label: 'a', description: 'A' }] } },
    { criterion: { kind: 'graded', instructions: 'Grade', direction: 'invalid', levels: [{ label: 'a', description: 'A' }] } },
    { criterion: { kind: 'choice', instructions: 'Choose', options: [{ id: 'a', description: 'A' }] }, decision: { kind: 'labels', passing: ['b'] } },
    { criterion: { kind: 'graded', instructions: 'Grade', direction: 'unordered', levels: [{ label: 'a', description: 'A' }] }, decision: { kind: 'labels', passing: ['b'] } },
    { decision: { kind: 'labels', passing: ['true'] } },
  ])('should refuse malformed request structure or undeclared labels: %j', (patch) => {
    expect(parseDecisionRequest({ ...request(), ...patch })).toEqual({ ok: false, code: 'REQUEST_INVALID' });
  });
  it('should reject malformed policy bounds while accepting an explicit zero spend cap', () => {
    for (const policy of [{ timeoutMs: 0 }, { timeoutMs: 60_001 }, { timeoutMs: 1.5 }, { budget: { maxCostMicroUsd: '01' } }, { budget: {} }, { explanation: 'fabricated' }]) {
      expect(parseDecisionRequest({ ...request(), policy }).ok).toBe(false);
    }
    expect(parseDecisionRequest({ ...request(), policy: { budget: { maxCostMicroUsd: '0' }, timeoutMs: 60_000 } }).ok).toBe(true);
    expect(parseDecisionRequest({ ...request(), policy: { budget: { maxCostMicroUsd: '9'.repeat(256) } } }).ok).toBe(true);
    expect(parseDecisionRequest({ ...request(), raw: { mode: 'allowlisted', maxBytes: 16_385 } }).ok).toBe(false);
  });
  it('should refuse excessive bytes, nesting and cyclic data before serialization', () => {
    expect(parseDecisionRequest({ ...request(), inputs: { output: 'é'.repeat(131_072) } }).ok).toBe(false);
    let nested: unknown = null;
    for (let i = 0; i < 16; i++) nested = [nested];
    expect(isBoundedJson(nested)).toBe(true);
    expect(isBoundedJson([nested])).toBe(false);
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(isBoundedJson(cyclic)).toBe(false);
  });
});

describe('decision criteria and explicit decision rules', () => {
  it('should preserve ordered labels and allow capabilities beyond JEV cardinalities', () => {
    const levels = Array.from({ length: 11 }, (_, i) => ({ label: String(i), description: `Level ${i}` }));
    expect(isDecisionCriterion({ kind: 'graded', instructions: 'Grade', direction: 'unordered', levels })).toBe(true);
    expect(isDecisionCriterion({ kind: 'graded', instructions: 'Grade', direction: 'unordered', levels: [...levels, levels[0]] })).toBe(false);
    expect(isDecisionCriterion({ kind: 'registered', criteriaId: 'support', revision: 'v1' })).toBe(true);
  });
  it('should reject empty rubrics, duplicate choices and unrecognized criterion fields', () => {
    const option = { id: 'safe', description: 'Safe answer' };
    for (const criterion of [
      { kind: 'binary', instructions: ' ' },
      { kind: 'binary', instructions: 'Check', criteria: { true: 'yes' } },
      { kind: 'choice', instructions: 'Choose', options: [] },
      { kind: 'choice', instructions: 'Choose', options: [option, option] },
      { kind: 'choice', instructions: 'Choose', options: [{ ...option, weight: 1 }] },
      { kind: 'registered', criteriaId: 'support', revision: '' },
    ]) expect(isDecisionCriterion(criterion)).toBe(false);
  });
  it('should require finite thresholds, declared rule fields and unique passing labels', () => {
    const threshold = { kind: 'threshold', field: 'score', op: 'gte', value: 0.7 };
    expect(isDecisionRule(threshold)).toBe(true);
    expect(isDecisionRule({ ...threshold, value: Infinity })).toBe(false);
    expect(isDecisionRule({ kind: 'provider', threshold: 0.5 })).toBe(false);
    expect(isDecisionRule({ kind: 'labels', passing: ['a', 'a'] })).toBe(false);
  });
});
