import { describe, expect, it, vi } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import type { LiveParagraph } from '../../../packages/chat-core/src/live-document-port';
import { captureBaselineDiff } from '../../src/services/canvas-live/freeze-capture';
import { baseline, paragraph } from '../helpers/canvas-live';

const capture = (text: string) => ({ complete: true, fields: [{ fieldKey: 'body',
  blocks: [{ paragraphId: 'paragraph-a', serialized: text, representable: true }] }] });
// Planned FE-3 witness: the injected Focus boundary sees the ORIGINAL baseline
// on every freeze, including after a cumulative draft is undone back to it.
const focusDouble = () => vi.fn((before: LiveParagraph[], after: LiveParagraph[], transactionId: string) => ({ transactionId,
  changes: isDeepStrictEqual(before, after) ? [] : [{ before, after }] }));

describe('canvas live FE-3 baseline bridge', () => {
  it('should capture one cumulative baseline-relative diff and return empty after undo to baseline', () => {
    const diffParagraphs = focusDouble();
    captureBaselineDiff(baseline, capture('intermediate'), 'tx-1', { diffParagraphs });
    const cumulative = captureBaselineDiff(baseline, capture('joint final'), 'tx-2', { diffParagraphs });
    expect(diffParagraphs).toHaveBeenLastCalledWith([paragraph('baseline')], [paragraph('joint final')], 'tx-2');
    expect(cumulative.transaction.changes).toHaveLength(1);
    expect(cumulative.baseline).toEqual(baseline);
    const undone = captureBaselineDiff(baseline, capture('baseline'), 'tx-3', { diffParagraphs });
    expect(undone.transaction.changes).toEqual([]);
    expect(baseline.headAtOpen).toBeNull();
  });

  it('should map split paragraph identities through retained manifest field addresses', () => {
    const captured = capture('first');
    captured.fields[0].blocks.push({ paragraphId: 'split-id', serialized: 'second', representable: true });
    const diffParagraphs = focusDouble();
    captureBaselineDiff(baseline, captured, 'split', { diffParagraphs });
    expect(diffParagraphs.mock.calls[0][1]).toEqual([
      paragraph('first'), { ...paragraph('second'), paragraphId: 'split-id' },
    ]);
  });

  it('should refuse partial unrepresentable duplicate or unmapped captures before calling Focus', () => {
    const diffParagraphs = focusDouble();
    const partial = capture('partial'); partial.complete = false;
    const unsupported = capture('raw'); unsupported.fields[0].blocks[0].representable = false;
    const duplicate = capture('duplicate'); duplicate.fields[0].blocks.push(duplicate.fields[0].blocks[0]);
    const unmapped = capture('foreign'); unmapped.fields[0].fieldKey = 'other';
    const missing = { complete: true, fields: [] };
    for (const invalid of [partial, unsupported, duplicate, unmapped, missing]) {
      expect(() => captureBaselineDiff(baseline, invalid, 'invalid', { diffParagraphs })).toThrow('capture');
    }
    expect(diffParagraphs).not.toHaveBeenCalled();
  });
});
