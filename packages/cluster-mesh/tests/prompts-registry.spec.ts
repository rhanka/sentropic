/**
 * CMP-P1 prompt registry v1 (GD-7): versioned, digested, audited.
 */
import { describe, it, expect } from 'vitest';
import {
  InMemoryPromptRegistry, promptContentDigest,
} from '../src/prompts/registry.js';

describe('CMP-P1 prompt registry (GD-7)', () => {
  it('digests content canonically', () => {
    expect(promptContentDigest('hello')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(promptContentDigest('hello')).toBe(promptContentDigest('hello'));
  });

  it('registers versions immutably with an audit trail', () => {
    const registry = new InMemoryPromptRegistry();
    registry.registerDefinition({ promptId: 'signal-detect', title: 'Signal detection' });
    const v1 = registry.registerVersion({
      promptId: 'signal-detect', version: 'v1', content: 'find signals', author: 'owner',
    });
    expect(v1.digest).toBe(promptContentDigest('find signals'));
    expect(() => registry.registerVersion({
      promptId: 'signal-detect', version: 'v1', content: 'changed', author: 'owner',
    })).toThrow('immutable');
    expect(registry.get('signal-detect', 'v1')?.digest).toBe(v1.digest);
    expect(registry.audit()).toHaveLength(1);
  });

  it('refuses unknown prompts and malformed ids fail-closed', () => {
    const registry = new InMemoryPromptRegistry();
    expect(() => registry.registerDefinition({ promptId: 'bad id', title: 'x' })).toThrow();
    expect(() => registry.registerVersion({
      promptId: 'ghost', version: 'v1', content: 'x', author: 'owner',
    })).toThrow('unknown prompt');
  });
});
