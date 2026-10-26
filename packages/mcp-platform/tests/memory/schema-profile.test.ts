import { describe, expect, it } from 'vitest';
import { admitMemorySchema, validateMemoryArguments } from '../../src/memory/schema-profile.js';
import { readFileSync } from 'node:fs';
const oracle = JSON.parse(readFileSync(new URL('../../../../tools/memory-mcp-l5/fixtures/l0/tool-schemas.json', import.meta.url), 'utf8'));

describe('P03.platform.schema-profile-2020-12', () => {
  it('should admit every pinned input and output asset before acquisition', () => {
    for (const tool of Object.values(oracle.schemas) as Array<{ inputSchema: unknown; outputSchema: unknown }>) {
      expect(() => admitMemorySchema(tool.inputSchema)).not.toThrow();
      expect(() => admitMemorySchema(tool.outputSchema)).not.toThrow();
    }
  });
  it.each(['$ref', 'anyOf', 'format', 'unevaluatedProperties'])('should refuse unsupported %s at any depth', keyword => {
    expect(() => admitMemorySchema({ type: 'object', additionalProperties: false,
      properties: { nested: { type: 'string', [keyword]: 'untrusted' } } })).toThrow();
  });
  it('should refuse unknown dialects, open objects and arbitrary patterns', () => {
    for (const schema of [{ $schema: 'draft-07', type: 'string' }, { type: 'object' },
      { type: 'string', pattern: '(a+)+' }]) expect(() => admitMemorySchema(schema)).toThrow();
  });
  it('should enforce nested union branches, UTF-8 bounds and unsigned u64', () => {
    const schema = { type: 'object', additionalProperties: false, required: ['value'], properties: {
      value: { oneOf: [{ type: 'string', maxLength: 4 }, { type: 'integer', minimum: 1, maximum: 2 }] },
      cursor: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    } };
    expect(validateMemoryArguments(schema, { value: 'éé', cursor: '18446744073709551615' })).toEqual([]);
    for (const value of [{ value: 'ééa' }, { value: 3 }, { value: 1, extra: true },
      { value: 1, cursor: '18446744073709551616' }, { value: '\ud800' }]) {
      expect(validateMemoryArguments(schema, value).length).toBeGreaterThan(0);
    }
  });
});
