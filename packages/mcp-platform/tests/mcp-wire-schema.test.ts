import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileMcpToolSchemas } from '../src/transport/tool-schemas.js';
import type { McpToolValidationLimits } from '../src/transport/tool-schemas.js';

const bytes = readFileSync(new URL('../../cluster-mesh/tests/conformance/fixtures/immo-tools.v1.json', import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex'))
  .toBe('31487e8fb9b85019fc707ed3a7296e33156c46fb5fd3071d456d6dae1b44d998');
const fixture = JSON.parse(bytes.toString());
export const limits: McpToolValidationLimits = {
  maxSchemaBytes: 2 ** 21, maxSchemaDepth: 128, maxRequestBytes: 2 ** 25,
  maxArgumentBytes: 2 ** 24, maxArgumentDepth: 64,
  maxResultBytes: 2 ** 25, maxResultDepth: 64,
};
const tools = fixture.tools;
const compiled = compileMcpToolSchemas(tools, limits);
const check = (name: string, args: unknown) => compiled.validate(name, args);

describe('original Immo MCP schemas', () => {
  it('accepts all twelve original schemas and every captured argument vector without mutation', () => {
    const before = JSON.stringify(tools);
    expect(tools).toHaveLength(12);
    for (const mode of ['http', 'simulation']) {
      for (const [name, call] of Object.entries(fixture.captures[mode].calls)) {
        const args = (call as { args: Record<string, unknown> }).args;
        const original = structuredClone(args);
        const result = check(name, args);
        expect(result.valid, name).toBe(true);
        expect(args).toEqual(original);
      }
    }
    expect(JSON.stringify(tools)).toBe(before);
  });
  it('applies every advertised property default only to missing values on a clone', () => {
    for (const tool of tools) {
      const args = fixture.captures.http.calls[tool.name].args;
      const result = check(tool.name, args);
      expect(result.valid).toBe(true);
      if (!result.valid) continue;
      for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
        if (!Object.hasOwn(args, name) && Object.hasOwn(schema as object, 'default')) {
          expect(result.data[name]).toEqual((schema as { default: unknown }).default);
        }
      }
    }
    for (const [tool, field] of [['search_lots', 'minArea'], ['get_lots_geojson', 'superficieMinM2']]) {
      expect(check(tool, { city: 'x', [field]: 1 }).valid).toBe(true);
      expect(check(tool, { city: 'x', [field]: 0 }).valid).toBe(false);
    }
    expect(check('get_lots_geojson', { city: 'x', only4Plus: false }).valid).toBe(true);
    expect(check('get_lots_geojson', { city: 'x', only4Plus: null }).valid).toBe(false);
    for (const limit of [0, 2001, '10']) {
      expect(check('get_lots_geojson', { city: 'x', limit }).valid).toBe(false);
    }
  });
  it('accepts unbounded strings and preserves draft-07 tuples and exclusive numeric bounds', () => {
    expect(check('search_lots', { city: 'x'.repeat(100_000) }).valid).toBe(true);
    const args = fixture.captures.http.calls.get_lots_geojson.args;
    expect(check('get_lots_geojson', { ...args, bbox: [1, 2, 3, 4] }).valid).toBe(true);
    for (const bbox of [[1, 2, 3], [1, 2, 3, 4, 5], [1, '2', 3, 4]]) {
      expect(check('get_lots_geojson', { ...args, bbox }).valid).toBe(false);
    }
  });
  it('refuses missing required fields, extra properties, wrong types and non-finite JSON', () => {
    for (const tool of tools) {
      const args = fixture.captures.http.calls[tool.name].args;
      expect(check(tool.name, { ...args, unexpected: true }).valid).toBe(false);
      for (const name of tool.inputSchema.required ?? []) {
        const missing = { ...args }; delete missing[name];
        expect(check(tool.name, missing).valid).toBe(false);
      }
    }
    for (const args of [null, [], { city: 12 }, { city: undefined }, { city: NaN }]) {
      expect(check('search_lots', args).valid).toBe(false);
    }
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(check('search_lots', cyclic).valid).toBe(false);
  });
  it('rejects unsupported schemas and independent resource budgets before calls', () => {
    for (const schema of [{ $ref: 'https://secret.test/schema' }, { $async: true },
      { $schema: 'unknown' }, { executable: 'x' }]) {
      expect(() => compileMcpToolSchemas([{ name: 'bad', inputSchema: { type: 'object', ...schema } }], limits)).toThrow();
    }
    expect(() => compileMcpToolSchemas(tools, { ...limits, maxRequestBytes: 0 })).toThrow();
    expect(() => compileMcpToolSchemas(tools, { ...limits, maxSchemaBytes: 4 })).toThrow();
    const bounded = compileMcpToolSchemas(tools, { ...limits, maxArgumentBytes: 12 });
    expect(bounded.validate('search_lots', { city: 'longueuil' }).valid).toBe(false);
  });
});
