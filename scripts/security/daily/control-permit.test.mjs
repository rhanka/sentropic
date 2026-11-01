import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { issuePermit, validatePermitUse } from './control-permit.mjs';

function issuance() {
  return {
    getResult: true,
    policyGeneration: 3,
    admittedGeneration: 3,
    readStartedAt: 100000,
    observedAt: 100001,
    issuedAt: 100002,
    nonce: 'ab'.repeat(32),
    usedNonces: [],
    tuple: { purpose: 'deadline-report', repositoryId: 123, enableEpoch: 2 },
    expectedTuple: { purpose: 'deadline-report', repositoryId: 123, enableEpoch: 2 },
    consumerHasSigningKey: false,
  };
}

describe('L8-G: permit issuance and single-use rules', () => {
  it('fresh literal-true GET with matching generation issues', () => {
    const permit = issuePermit(issuance());
    assert.equal(permit.notBefore, 100002);
    assert.equal(permit.expiresAt, 105000);
  });

  it('false/stale GET and generation drift refuse', () => {
    assert.throws(() => issuePermit({ ...issuance(), getResult: false }));
    assert.throws(() => issuePermit({ ...issuance(), admittedGeneration: 4 }));
    assert.throws(() => issuePermit({ ...issuance(), observedAt: 99999 }));
  });

  it('consumer holding a signing key refuses', () => {
    assert.throws(() => issuePermit({ ...issuance(), consumerHasSigningKey: true }));
  });

  it('nonce reuse, reordered sequence and keepalive extension fail', () => {
    const first = issuance();
    const permit = issuePermit(first);
    assert.deepEqual(validatePermitUse(permit, { now: 103000, nonce: 'ab'.repeat(32), usedNonces: [] }), []);
    assert.ok(validatePermitUse(permit, { now: 103000, nonce: 'ab'.repeat(32), usedNonces: ['ab'.repeat(32)] }).length > 0);
    assert.ok(validatePermitUse(permit, { now: 105001, nonce: 'cd'.repeat(32), usedNonces: [] }).length > 0);
    assert.ok(validatePermitUse(permit, { now: 103000, nonce: 'cd'.repeat(32), usedNonces: [], keepalive: true }).length > 0);
  });
});
