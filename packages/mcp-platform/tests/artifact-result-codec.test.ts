import { describe, expect, it } from 'vitest';
import { decodeToolResult, encodeToolResult } from '../src/transport/result-codec.js';
import type { AppToolResult } from '../src/runtime.js';

describe('commit outcome MCP codec', () => {
  it.each(['not_committed', 'committed', 'unknown'] as const)(
    'should retain %s and typed details in content and round trips', commitState => {
      const result: AppToolResult = { ok: false, auditId: 'audit', redactionClass: 'low',
        invocationId: 'invocation', commitState,
        error: { code: 'conflict', message: 'conflict', retriable: false,
          details: { variant: 'pointer_conflict', currentReleaseId: 'release' } } };
      const wire = encodeToolResult(result);
      expect(wire.isError).toBe(true);
      expect(JSON.parse((wire.content[0] as { text: string }).text)).toEqual({
        ok: false, invocationId: 'invocation', commitState, error: result.error });
      expect(decodeToolResult(wire)).toEqual(result);
    });

  it('should retain replayed success and read-only commit state without duplicating content', () => {
    for (const commitState of ['committed', 'not_committed'] as const) {
      const result: AppToolResult = { ok: true, output: { releaseId: 'release' }, auditId: 'audit',
        redactionClass: 'low', invocationId: 'invocation', commitState, replayed: true };
      const wire = encodeToolResult(result);
      expect(wire.structuredContent).toBeUndefined();
      expect(JSON.parse((wire.content[0] as { text: string }).text)).toMatchObject({
        ok: true, output: result.output, commitState, replayed: true });
      expect(decodeToolResult(wire)).toEqual(result);
    }
  });

  it('should leave other provider outputs unchanged', () => {
    const result: AppToolResult = { ok: true, output: { text: 'unchanged' }, auditId: 'a', redactionClass: 'low' };
    expect(JSON.parse((encodeToolResult(result).content[0] as { text: string }).text)).toEqual(result.output);
    expect(decodeToolResult(encodeToolResult(result))).toEqual(result);
  });
});
