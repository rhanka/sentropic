/**
 * L-5a — provider parameters: schema-validated non-secret values.
 *
 * A parameter schema declares the generic settings a provider accepts
 * (string/number/boolean/enum, required or defaulted). Validation applies
 * defaults, rejects unknown keys, wrong types and missing required values,
 * and refuses secret-looking keys: provider parameters are never a secret
 * store. Schemas are independent; values validated under one schema never
 * leak into another.
 */
import { describe, expect, it } from 'vitest';
import {
  defineParameters,
  validateParameters,
} from '../src/parameters.js';

const SCHEMA = defineParameters([
  { key: 'title', type: 'string', required: true },
  { key: 'theme', type: 'enum', values: ['light', 'dark'], default: 'light' },
  { key: 'pageSize', type: 'number', default: 20 },
  { key: 'showSource', type: 'boolean', default: false },
]);

describe('provider parameters', () => {
  it('applies defaults and accepts valid values', () => {
    expect(validateParameters(SCHEMA, { title: 'Hello' })).toEqual({
      title: 'Hello',
      theme: 'light',
      pageSize: 20,
      showSource: false,
    });
    expect(
      validateParameters(SCHEMA, { title: 'Hi', theme: 'dark', pageSize: 5, showSource: true }),
    ).toEqual({ title: 'Hi', theme: 'dark', pageSize: 5, showSource: true });
  });

  it('rejects unknown keys, wrong types and missing required values', () => {
    expect(() => validateParameters(SCHEMA, { title: 'Hi', unknown: 1 })).toThrow(/unknown parameter/);
    expect(() => validateParameters(SCHEMA, { title: 'Hi', pageSize: 'many' })).toThrow(
      /pageSize/,
    );
    expect(() => validateParameters(SCHEMA, { title: 'Hi', theme: 'blue' })).toThrow(/theme/);
    expect(() => validateParameters(SCHEMA, {})).toThrow(/title/);
  });

  it('refuses secret-looking keys fail-closed', () => {
    expect(() => validateParameters(SCHEMA, { title: 'Hi', apiSecret: 'x' })).toThrow(/secret/);
    expect(() => validateParameters(SCHEMA, { title: 'Hi', clientToken: 'x' })).toThrow(/secret/);
    expect(() => validateParameters(SCHEMA, { title: 'Hi', dbPassword: 'x' })).toThrow(/secret/);
  });

  it('rejects duplicate and empty declarations at definition time', () => {
    expect(() =>
      defineParameters([
        { key: 'a', type: 'string' },
        { key: 'a', type: 'number' },
      ]),
    ).toThrow(/duplicate/);
    expect(() => defineParameters([{ key: '', type: 'string' }])).toThrow(/key/);
    expect(() => defineParameters([{ key: 'e', type: 'enum', values: [] }])).toThrow(/values/);
  });
});
