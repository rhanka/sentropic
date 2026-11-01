import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canExecute } from './control-image-pin.mjs';

describe('L8-K: only the reviewed pinned digest executes', () => {
  it('unpinned control cannot execute or unlock an environment', () => {
    assert.equal(canExecute({ pinnedDigest: null, candidateDigest: 'sha256:x', offDrainReceipt: true }), false);
  });

  it('second pushed digest without a reviewed pin update never executes', () => {
    assert.equal(
      canExecute({ pinnedDigest: 'sha256:old', candidateDigest: 'sha256:new', offDrainReceipt: true }),
      false,
    );
  });

  it('reviewed pin update while off permits the new digest path', () => {
    assert.equal(
      canExecute({ pinnedDigest: 'sha256:new', candidateDigest: 'sha256:new', offDrainReceipt: true }),
      true,
    );
    assert.equal(
      canExecute({ pinnedDigest: 'sha256:new', candidateDigest: 'sha256:new', offDrainReceipt: false }),
      false,
    );
  });
});
