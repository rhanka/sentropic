/**
 * Lot 5 — wire parity: one result codec shared by both transports.
 * `decode(encode(x))` is the identity, and both transports carry the exact
 * same wire bytes for the same result. Malformed wire is refused.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeToolResult,
  encodeToolResult,
} from '../src/transport/result-codec.js';
import type { AppToolResult } from '../src/runtime.js';

const OK_RESULT: AppToolResult = {
  ok: true,
  output: { surface: 80, city: 'Lyon' },
  auditId: 'audit-1',
  redactionClass: 'low',
};

const ERROR_RESULT: AppToolResult = {
  ok: false,
  auditId: 'audit-2',
  redactionClass: 'low',
  error: { code: 'invalid_parameters', message: 'surface out of bounds', retriable: false },
};

describe('wire parity (shared result codec)', () => {
  it('round-trips success results through the wire form', () => {
    const wire = encodeToolResult(OK_RESULT);
    expect(wire.isError).toBe(false);
    expect(wire.content).toHaveLength(1);
    expect(decodeToolResult(wire)).toEqual(OK_RESULT);
  });

  it('round-trips error results with code and message preserved', () => {
    const wire = encodeToolResult(ERROR_RESULT);
    expect(wire.isError).toBe(true);
    expect(decodeToolResult(wire)).toEqual(ERROR_RESULT);
  });

  it('carries audit identity out-of-band, never inside the content text', () => {
    const wire = encodeToolResult(OK_RESULT);
    const text = (wire.content[0] as { text: string }).text;
    expect(text).not.toContain('audit-1');
    expect(wire._meta).toMatchObject({ auditId: 'audit-1' });
    expect(decodeToolResult(wire).auditId).toBe('audit-1');
  });

  it('refuses malformed wire payloads', () => {
    expect(() => decodeToolResult({ content: [], isError: false })).toThrow(/content/);
    expect(() =>
      decodeToolResult({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] }),
    ).toThrow(/text/);
    expect(() => decodeToolResult({ content: [{ type: 'text', text: '{oops' }] })).toThrow(
      /parse/,
    );
    expect(() =>
      decodeToolResult({ content: [{ type: 'text', text: '{}' }], isError: 'yes' }),
    ).toThrow(/isError/);
  });
});
