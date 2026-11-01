import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { offPropagation, descendantTermination } from './enable.mjs';

describe('L8-G: cross-process off and descendant termination', () => {
  it('off blocks new sends at every boundary immediately', () => {
    const verdict = offPropagation({ boundaries: ['admission', 'reservation', 'dispatch', 'send', 'publication', 'merge'], offObserved: true });
    assert.deepEqual(verdict.blocked, ['admission', 'reservation', 'dispatch', 'send', 'publication', 'merge']);
  });

  it('descendants terminate within the bound even under forged traffic', () => {
    assert.equal(descendantTermination({ detectedAt: 0, terminatedAt: 59000, forgedTraffic: true }).verdict, 'ok');
    assert.equal(descendantTermination({ detectedAt: 0, terminatedAt: 61000, forgedTraffic: true }).verdict, 'exceeded-detect');
  });
});
