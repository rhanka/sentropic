/**
 * Lot L-1b-core RC-M2(b) — RFC 8785 (JCS) canonical JSON and digests.
 *
 * Pure and dependency-free: strict raw-JSON parsing with duplicate-key and
 * lone-surrogate rejection, canonical serialization (UTF-16 key order, minimal
 * escapes, IEEE-754 numbers), full SHA-256 entry digests and exact-byte asset
 * digests. Node's `node:crypto` is the only runtime import.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from './tool-configuration.js';

// ---------------------------------------------------------------------------
// Strict raw-JSON parsing (duplicate keys and lone surrogates rejected)
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new SyntaxError(`invalid registry JSON: ${message}`);
}

function assertNoLoneSurrogates(text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        fail('lone surrogate escape is not valid JSON data');
      }
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail('lone surrogate escape is not valid JSON data');
    }
  }
}

type Parser = {
  text: string;
  index: number;
};

function skipWhitespace(parser: Parser): void {
  while (parser.index < parser.text.length) {
    const unit = parser.text.charCodeAt(parser.index);
    if (unit === 0x20 || unit === 0x09 || unit === 0x0a || unit === 0x0d) {
      parser.index += 1;
    } else {
      return;
    }
  }
}

function parseValue(parser: Parser): unknown {
  skipWhitespace(parser);
  const char = parser.text[parser.index];
  if (char === '{') return parseObject(parser);
  if (char === '[') return parseArray(parser);
  if (char === '"') return parseString(parser);
  if (char === 't' || char === 'f' || char === 'n') return parseKeyword(parser);
  return parseNumber(parser);
}

function parseObject(parser: Parser): Record<string, unknown> {
  parser.index += 1;
  const result: Record<string, unknown> = {};
  skipWhitespace(parser);
  if (parser.text[parser.index] === '}') {
    parser.index += 1;
    return result;
  }
  for (;;) {
    skipWhitespace(parser);
    if (parser.text[parser.index] !== '"') fail('object keys must be strings');
    const key = parseString(parser);
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      fail(`duplicate key ${JSON.stringify(key)}`);
    }
    skipWhitespace(parser);
    if (parser.text[parser.index] !== ':') fail('object entries require a colon');
    parser.index += 1;
    result[key] = parseValue(parser);
    skipWhitespace(parser);
    const next = parser.text[parser.index];
    if (next === ',') {
      parser.index += 1;
      continue;
    }
    if (next === '}') {
      parser.index += 1;
      return result;
    }
    fail('object entries require a comma or closing brace');
  }
}

function parseArray(parser: Parser): unknown[] {
  parser.index += 1;
  const result: unknown[] = [];
  skipWhitespace(parser);
  if (parser.text[parser.index] === ']') {
    parser.index += 1;
    return result;
  }
  for (;;) {
    result.push(parseValue(parser));
    skipWhitespace(parser);
    const next = parser.text[parser.index];
    if (next === ',') {
      parser.index += 1;
      continue;
    }
    if (next === ']') {
      parser.index += 1;
      return result;
    }
    fail('array entries require a comma or closing bracket');
  }
}

function parseString(parser: Parser): string {
  let out = '';
  parser.index += 1;
  for (;;) {
    if (parser.index >= parser.text.length) fail('unterminated string');
    const char = parser.text[parser.index]!;
    if (char === '"') {
      parser.index += 1;
      assertNoLoneSurrogates(out);
      return out;
    }
    if (char === '\\') {
      const esc = parser.text[parser.index + 1];
      if (esc === undefined) fail('unterminated escape');
      if (esc === 'u') {
        const hex = parser.text.slice(parser.index + 2, parser.index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid unicode escape');
        out += String.fromCharCode(Number.parseInt(hex, 16));
        parser.index += 6;
        continue;
      }
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      const mapped = simple[esc];
      if (mapped === undefined) fail('invalid escape');
      out += mapped;
      parser.index += 2;
      continue;
    }
    const unit = parser.text.charCodeAt(parser.index);
    if (unit < 0x20) fail('unescaped control character');
    out += char;
    parser.index += 1;
  }
}

function parseKeyword(parser: Parser): unknown {
  for (const [word, value] of [['true', true], ['false', false], ['null', null]] as const) {
    if (parser.text.startsWith(word, parser.index)) {
      parser.index += word.length;
      return value;
    }
  }
  fail('unexpected token');
}

const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function parseNumber(parser: Parser): number {
  NUMBER_PATTERN.lastIndex = parser.index;
  const match = NUMBER_PATTERN.exec(parser.text);
  if (match === null) fail('unexpected token');
  parser.index += match[0].length;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) fail('non-finite number is not valid JSON data');
  return value;
}

/**
 * Parse raw JSON text strictly: duplicate keys, lone surrogates, non-finite
 * numbers, trailing data and malformed text are rejected.
 */
export function parseStrictJson(text: string): unknown {
  assertNoLoneSurrogates(text);
  const parser: Parser = { text, index: 0 };
  const value = parseValue(parser);
  skipWhitespace(parser);
  if (parser.index !== text.length) fail('trailing data after the top-level value');
  return value;
}

/**
 * Canonical JCS serialization of an in-memory JSON value. Reuses the
 * deterministic serializer and additionally rejects lone surrogates, which are
 * not valid JSON scalar data.
 */
export function canonicalJsonText(value: unknown): string {
  assertNoLoneSurrogates(JSON.stringify(value) ?? '');
  return canonicalJson(value);
}

/** Parse strictly, then canonicalize: equivalent spellings give one form. */
export function canonicalizeJsonText(text: string): string {
  return canonicalJsonText(parseStrictJson(text));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Full SHA-256 over the RFC 8785 canonical descriptor bytes. */
export function entryDigestHex(descriptor: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJsonText(descriptor)));
}

/** Full SHA-256 over exact asset bytes. */
export function assetDigestHex(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
