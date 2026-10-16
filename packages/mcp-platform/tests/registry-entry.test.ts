import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildRegistryEntry,
  canonicalizeRegistryRequest,
  mapEntryArguments,
} from '../src/registry-entry.js';
import type { CompiledToolEntry } from '../src/tool-configuration.js';

const COMPILED: CompiledToolEntry = {
  toolName: 'immo.price.estimate',
  capabilityRef: 'immo.price',
  handlerId: 'price-estimate-v1',
  values: {},
  requiredScopes: [],
  requiredClaims: [],
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: 'safe',
  redactionClass: 'none',
  gates: [],
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface', 'city'],
  properties: {
    surface: { type: 'number', minimum: 9, maximum: 10000 },
    city: { type: 'string', minLength: 1, maxLength: 96 },
  },
};

const ARGS = { surface: 80, city: 'Lyon' };

describe('registry entry abstraction (RC-M2a)', () => {
  it('canonicalizes equivalent argument spellings to one digest', () => {
    const a = canonicalizeRegistryRequest({ tool: COMPILED.toolName, args: ARGS, tenant: 't-1' });
    const b = canonicalizeRegistryRequest({ tool: COMPILED.toolName, args: { city: 'Lyon', surface: 80 }, tenant: 't-1' });
    expect(a.digest).toBe(b.digest);
    expect(a.canonicalText).toBe(b.canonicalText);
    expect(a.canonicalText).toBe('{"args":{"city":"Lyon","surface":80},"tenant":"t-1","tool":"immo.price.estimate"}');
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('builds a frozen entry carrying compiled identity and canonical request', () => {
    const canonical = canonicalizeRegistryRequest({ tool: COMPILED.toolName, args: ARGS });
    const entry = buildRegistryEntry(COMPILED, SCHEMA, canonical);
    expect(entry.toolName).toBe('immo.price.estimate');
    expect(entry.capabilityRef).toBe('immo.price');
    expect(entry.canonical.digest).toBe(canonical.digest);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('refuses a canonical request bound to another tool', () => {
    const canonical = canonicalizeRegistryRequest({ tool: 'other.tool', args: ARGS });
    expect(() => buildRegistryEntry(COMPILED, SCHEMA, canonical)).toThrow(/does not match/);
  });

  it('maps runtime arguments through the bounded schema (RC-M2c)', () => {
    const canonical = canonicalizeRegistryRequest({ tool: COMPILED.toolName, args: ARGS });
    const entry = buildRegistryEntry(COMPILED, SCHEMA, canonical);
    const mapped = mapEntryArguments(entry, ARGS);
    expect(mapped).toEqual(ARGS);
    expect(Object.isFrozen(mapped)).toBe(true);
  });

  it('is exposed as the ./registry/entry subpath with types (packed proof)', async () => {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };
    expect(pkg.exports?.['./registry/entry']).toEqual({
      types: './dist/registry-entry.d.ts',
      import: './dist/registry-entry.js',
    });
    const distUrl = new URL('../dist/registry-entry.js', import.meta.url).href;
    const packaged = (await import(distUrl)) as typeof import('../src/registry-entry.js');
    const fromSrc = canonicalizeRegistryRequest({ tool: COMPILED.toolName, args: ARGS });
    const fromDist = packaged.canonicalizeRegistryRequest({ tool: COMPILED.toolName, args: ARGS });
    expect(fromDist.digest).toBe(fromSrc.digest);
    expect(fromDist.canonicalText).toBe(fromSrc.canonicalText);
  });

  it('rejects unknown slots, missing slots and out-of-bounds values', () => {
    const canonical = canonicalizeRegistryRequest({ tool: COMPILED.toolName, args: ARGS });
    const entry = buildRegistryEntry(COMPILED, SCHEMA, canonical);
    expect(() => mapEntryArguments(entry, { ...ARGS, extra: 1 })).toThrow(/unknown property/);
    expect(() => mapEntryArguments(entry, { surface: 80 })).toThrow(/missing required property/);
    expect(() => mapEntryArguments(entry, { surface: 5, city: 'Lyon' })).toThrow(/out of bounds/);
  });
});
