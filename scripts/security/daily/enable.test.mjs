import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blankState, applyTransaction } from './enable.mjs';

describe('L8-G: global-off-first enable', () => {
  it('first enable starts from verified global off', () => {
    const next = applyTransaction(blankState(), {
      globalOffVerified: true,
      terminated: true,
      policyMerged: true,
      reverifiedLive: [],
      enablePurpose: 'deadline-report',
      epoch: 1,
    });
    assert.equal(next.globalOn, true);
    assert.deepEqual(next.live, ['deadline-report']);
  });

  it('second purpose while live needs every live purpose reverified', () => {
    const live = applyTransaction(blankState(), {
      globalOffVerified: true,
      terminated: true,
      policyMerged: true,
      reverifiedLive: [],
      enablePurpose: 'deadline-report',
      epoch: 1,
    });
    assert.throws(() =>
      applyTransaction(live, {
        globalOffVerified: false,
        terminated: true,
        policyMerged: true,
        reverifiedLive: [],
        enablePurpose: 'discovery',
        epoch: 2,
      }),
    );
    const next = applyTransaction(live, {
      globalOffVerified: false,
      terminated: true,
      policyMerged: true,
      reverifiedLive: ['deadline-report'],
      enablePurpose: 'discovery',
      epoch: 2,
    });
    assert.deepEqual(next.live.sort(), ['deadline-report', 'discovery'].sort());
  });

  it('failures retain off and holds', () => {
    assert.throws(() =>
      applyTransaction(blankState(), {
        globalOffVerified: false,
        terminated: true,
        policyMerged: true,
        reverifiedLive: [],
        enablePurpose: 'deadline-report',
        epoch: 1,
      }),
    );
    const state = blankState();
    assert.equal(state.globalOn, false);
    assert.deepEqual(state.live, []);
  });
});
