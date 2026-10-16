import { describe, expect, it } from 'vitest';
import { resolveRegistryEntry } from '../src/registry-entry.js';
import type { CompiledToolConfiguration, CompiledToolEntry } from '../src/tool-configuration.js';

const TOOL: CompiledToolEntry = {
  toolName: 'immo.price.estimate',
  capabilityRef: 'immo.price.estimate',
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

const CONFIG = { tools: [TOOL] } as CompiledToolConfiguration;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: { surface: { type: 'number', minimum: 9, maximum: 10000 } },
};

describe('registry entry wiring (RC-M2b)', () => {
  it('resolves a compiled tool to a mapped entry in one call', () => {
    const resolved = resolveRegistryEntry(CONFIG, SCHEMA, {
      tool: 'immo.price.estimate',
      args: { surface: 80 },
      tenant: 't-1',
    });
    expect(resolved.entry.handlerId).toBe('price-estimate-v1');
    expect(resolved.args).toEqual({ surface: 80 });
    expect(resolved.entry.canonical.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects unknown tools before touching arguments', () => {
    expect(() =>
      resolveRegistryEntry(CONFIG, SCHEMA, { tool: 'nope.tool', args: {} }),
    ).toThrow(/Unknown tool/);
  });

  it('rejects invalid arguments with the bounded diagnostics', () => {
    expect(() =>
      resolveRegistryEntry(CONFIG, SCHEMA, { tool: TOOL.toolName, args: { surface: 1 } }),
    ).toThrow(/out of bounds/);
  });
});
