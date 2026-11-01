import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { baselineJobs, admit, CAPS } from './resource-envelope.mjs';

describe('T6-B1: section 7.4 envelope for L08a rows', () => {
  it('baseline is 1922N+496, hence 2418 at N=1', () => {
    assert.equal(baselineJobs(1), 2418);
    assert.equal(baselineJobs(2), 1922 * 2 + 496);
  });

  it('last permitted image promotion passes, one more refuses', () => {
    const cap = CAPS.promotions(1);
    assert.equal(cap, 31);
    assert.equal(admit({ used: 30, requested: 1, cap }).allowed, true);
    assert.equal(admit({ used: 31, requested: 1, cap }).allowed, false);
  });

  it('state transactions, PR bridge, merges and CI hold their frozen caps', () => {
    assert.equal(CAPS.stateTransactions, 1024);
    assert.equal(admit({ used: 1024, requested: 1, cap: CAPS.stateTransactions }).allowed, false);
    assert.equal(CAPS.prCampaigns(62), 130);
    assert.equal(CAPS.merges(62), 68);
    assert.equal(CAPS.prCiJobs, 128);
    assert.equal(CAPS.releaseJobs, 128);
    assert.equal(CAPS.qualification, 4096);
  });

  it('unknown counts and undeclared retries refuse', () => {
    assert.equal(admit({ used: undefined, requested: 1, cap: 31 }).allowed, false);
    assert.equal(admit({ used: 1, requested: 1, cap: 31, retry: true, reserved: false }).allowed, false);
    assert.equal(admit({ used: 1, requested: 1, cap: 31, retry: true, reserved: true }).allowed, true);
  });
});
