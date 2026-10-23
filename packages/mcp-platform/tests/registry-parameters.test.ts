/**
 * Lot L-1b-core RC-M2(c) — bounded 2020-12 parameter profile tests (pure).
 *
 * Closed keyword set, the single admitted safe pattern, work budgets,
 * const/enum/defaults and the frozen validator-port seam. No network, no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  BOUNDED_PROFILE_ID,
  createValidatorPorts,
  validateBoundedSchema,
  validateBoundedValue,
  withDefaults,
} from '../src/registry-parameters.js';

const MINIMAL = {
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: { mode: { const: 'snapshot' } },
};

describe('bounded 2020-12 parameter profile', () => {
  it('accepts the closed keyword set and rejects the rest', () => {
    expect(validateBoundedSchema(MINIMAL)).toEqual([]);
    expect(validateBoundedSchema({ type: 'object', properties: {} })).not.toEqual([]);
    expect(validateBoundedSchema({ type: 'object', additionalProperties: false, properties: {}, $ref: '#/x' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported_schema_profile' })]),
    );
    for (const keyword of ['anyOf', 'allOf', 'oneOf', 'not', 'if', 'patternProperties', 'format']) {
      expect(
        validateBoundedSchema({ type: 'object', additionalProperties: false, properties: { a: { [keyword]: [] } } }),
        keyword,
      ).not.toEqual([]);
    }
  });

  it('admits only the fixed safe pattern literal', () => {
    const good = {
      type: 'object',
      additionalProperties: false,
      properties: { ref: { type: 'string', minLength: 1, maxLength: 96, pattern: '^[a-z0-9][a-z0-9._-]*$' } },
    };
    expect(validateBoundedSchema(good)).toEqual([]);
    expect(validateBoundedValue(good, { ref: 'abc.def-9_x' })).toEqual([]);
    expect(validateBoundedValue(good, { ref: 'ABC' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_parameters' })]),
    );
    const evil = {
      type: 'object',
      additionalProperties: false,
      properties: { ref: { type: 'string', minLength: 1, maxLength: 96, pattern: '^(a+)+$' } },
    };
    expect(validateBoundedSchema(evil)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported_schema_profile' })]),
    );
  });

  it('enforces work budgets on schemas and values', () => {
    const deep: Record<string, unknown> = { type: 'object', additionalProperties: false, properties: {} };
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      const next: Record<string, unknown> = { type: 'object', additionalProperties: false, properties: {} };
      (cursor.properties as Record<string, unknown>)[`l${i}`] = next;
      cursor = next;
    }
    expect(validateBoundedSchema(deep)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported_schema_profile' })]),
    );
    const wide: Record<string, unknown> = { type: 'object', additionalProperties: false, properties: {} };
    for (let i = 0; i < 200; i += 1) wide.properties[`p${i}`] = { type: 'boolean' };
    expect(validateBoundedSchema({ type: 'object', additionalProperties: false, properties: wide.properties })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported_schema_profile' })]),
    );
    const bigEnum: unknown[] = [];
    for (let i = 0; i < 200; i += 1) bigEnum.push(i);
    expect(
      validateBoundedSchema({ type: 'object', additionalProperties: false, properties: { e: { enum: bigEnum } } }),
    ).not.toEqual([]);
    const bigArray: unknown[] = [];
    for (let i = 0; i < 2000; i += 1) bigArray.push(1);
    const listSchema = {
      type: 'object',
      additionalProperties: false,
      properties: { items: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 100 }, minItems: 0, maxItems: 5000 } },
    };
    expect(validateBoundedSchema(listSchema)).toEqual([]);
    expect(validateBoundedValue(listSchema, { items: bigArray })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_parameters' })]),
    );
  });

  it('validates const/enum/bounds/closedness and applies defaults', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { const: 'snapshot' },
        locale: { enum: ['en', 'fr'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    };
    expect(validateBoundedValue(schema, { mode: 'snapshot', locale: 'en', limit: 5 })).toEqual([]);
    expect(validateBoundedValue(schema, {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_parameters' })]),
    );
    expect(validateBoundedValue(schema, { mode: 'live', locale: 'en' })).not.toEqual([]);
    expect(validateBoundedValue(schema, { mode: 'snapshot', extra: 1 })).not.toEqual([]);
    expect(withDefaults(schema, { mode: 'snapshot' }, { locale: 'en', limit: 10 })).toEqual({
      mode: 'snapshot',
      locale: 'en',
      limit: 10,
    });
  });

  it('serves the frozen validator-port seam with the builtin profile', () => {
    const ports = createValidatorPorts();
    expect(ports.get(BOUNDED_PROFILE_ID)).toBeDefined();
    expect(() => ports.get('example.com/unknown/v1')).toThrowError(/unsupported/i);
    expect(ports.get(BOUNDED_PROFILE_ID).validate(MINIMAL, { mode: 'snapshot' })).toEqual([]);
    const custom = {
      profileId: 'example.com/custom/v1',
      validate: () => [],
    };
    ports.register(custom);
    expect(ports.get('example.com/custom/v1')).toBe(custom);
    expect(() => ports.register(custom)).toThrowError(/duplicate/i);
    expect(Object.isFrozen(ports)).toBe(true);
  });
});
