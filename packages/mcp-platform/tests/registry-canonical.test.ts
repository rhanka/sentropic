/**
 * Lot L-1b-core RC-M2(b) — RFC 8785 canonical JSON tests (pure, no I/O).
 *
 * Key ordering (UTF-16 code units, astral plane included), string escaping,
 * IEEE-754 numbers (negative zero, no non-finite), raw-text duplicate-key
 * rejection, lone-surrogate rejection and SHA-256 digest APIs.
 */
import { describe, expect, it } from 'vitest';
import {
  assetDigestHex,
  canonicalizeJsonText,
  canonicalJsonText,
  entryDigestHex,
  parseStrictJson,
} from '../src/registry-canonical.js';

describe('RFC 8785 canonical JSON', () => {
  it('orders object keys by UTF-16 code units, astral plane included', () => {
    expect(canonicalJsonText({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJsonText({ 'é': 1, z: 2, ä: 3 })).toBe('{"z":2,"ä":3,"é":1}');
    expect(canonicalJsonText({ '\u{1F600}': 1, '~': 2 })).toBe('{"~":2,"😀":1}');
    expect(canonicalJsonText({ '': 0, nested: { z: 1, a: [3, 2, { b: 0 }] } })).toBe(
      '{"":0,"nested":{"a":[3,2,{"b":0}],"z":1}}',
    );
  });

  it('escapes controls, quote and backslash; leaves DEL and non-ASCII bare', () => {
    expect(canonicalJsonText({ s: 'a"b\\c\rd\te\nf\bg\fh' })).toBe(
      '{"s":"a\\"b\\\\c\\rd\\te\\nf\\bg\\fh"}',
    );
    expect(canonicalJsonText({ s: 'é😀' })).toBe('{"s":"é😀"}');
  });

  it('serializes negative zero as zero and rejects non-finite numbers', () => {
    expect(canonicalJsonText({ n: -0 })).toBe('{"n":0}');
    expect(() => canonicalJsonText({ n: Number.NaN })).toThrowError(/finite/i);
    expect(() => canonicalJsonText({ n: Number.POSITIVE_INFINITY })).toThrowError(/finite/i);
  });

  it('rejects duplicate keys in raw text, including nested objects', () => {
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrowError(/duplicate key/i);
    expect(() => parseStrictJson('{"a":{"b":1,"b":2}}')).toThrowError(/duplicate key/i);
    expect(parseStrictJson('{"a":1,"b":1}')).toEqual({ a: 1, b: 1 });
  });

  it('rejects lone surrogates, trailing data and malformed text', () => {
    expect(() => parseStrictJson('"\\ud800"')).toThrowError(/surrogate/i);
    expect(() => parseStrictJson('{"a":1} trailing')).toThrowError(/trailing|unexpected/i);
    expect(() => parseStrictJson('{unquoted:1}')).toThrowError(/unexpected|string/i);
    expect(() => parseStrictJson('Infinity')).toThrowError(/unexpected|finite|token/i);
  });

  it('canonicalizes equivalent spellings to one form', () => {
    expect(canonicalizeJsonText('{ "b" : 1.0e1 , "a" : [1, 2.50] }')).toBe('{"a":[1,2.5],"b":10}');
  });

  it('digests the canonical descriptor deterministically', () => {
    const first = entryDigestHex({ format: 'sentropic.registry-entry/v1', id: 'x' });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(entryDigestHex({ id: 'x', format: 'sentropic.registry-entry/v1' })).toBe(first);
    expect(entryDigestHex({ format: 'sentropic.registry-entry/v1', id: 'y' })).not.toBe(first);
  });

  it('digests exact asset bytes (RFC 4231 vector)', () => {
    expect(assetDigestHex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
