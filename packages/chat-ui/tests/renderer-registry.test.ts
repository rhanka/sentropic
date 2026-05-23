/**
 * BR14a Lot 2 — @sentropic/chat-ui renderer registry contract tests.
 */
import { describe, expect, it } from 'vitest';

import {
  createRendererRegistry,
  type RendererRegistry,
  type ToolRenderer,
} from '../src/renderers/registry.js';

describe('createRendererRegistry', () => {
  it('returns an object exposing register, get, and default', () => {
    const registry: RendererRegistry = createRendererRegistry();
    expect(typeof registry.register).toBe('function');
    expect(typeof registry.get).toBe('function');
    expect(typeof registry.default).toBe('function');
  });

  it('register + get roundtrip returns the same renderer instance', () => {
    const registry = createRendererRegistry();
    const renderer: ToolRenderer<{ value: number }, string> = (input) =>
      `value=${input.value}`;
    registry.register('multiply', renderer);
    const resolved = registry.get('multiply') as ToolRenderer<{ value: number }, string>;
    expect(resolved).toBe(renderer);
    expect(resolved({ value: 42 })).toBe('value=42');
  });

  it('get returns undefined for unknown tool names so callers can fall back to default', () => {
    const registry = createRendererRegistry();
    expect(registry.get('unknown-tool')).toBeUndefined();
  });

  it('default renderer falls back to JSON.stringify for arbitrary payloads', () => {
    const registry = createRendererRegistry();
    expect(registry.default({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
    expect(registry.default(null)).toBe('null');
    expect(registry.default(undefined)).toBe('null');
  });

  it('last register call wins for the same tool name', () => {
    const registry = createRendererRegistry();
    const first: ToolRenderer<unknown, string> = () => 'first';
    const second: ToolRenderer<unknown, string> = () => 'second';
    registry.register('tool', first);
    registry.register('tool', second);
    const resolved = registry.get('tool') as ToolRenderer<unknown, string>;
    expect(resolved).toBe(second);
    expect(resolved({})).toBe('second');
  });

  it('default renderer survives non-serializable payloads via string fallback', () => {
    const registry = createRendererRegistry();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = registry.default(cyclic);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
