import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE_HASHES,parseOriginalRehearsal,fencedReceipt } from './t3-rehearsal.mjs';
export const qualifiedReceipt = () => ({ format: 'prod-a4-rehearsal/2',receiptRef: 'track:qualified-rehearsal',
  applicabilityReviewRef: 'track:prior-review',isolatedRestoreRef: 'track:isolated-restore',
  candidateCommit: 'b'.repeat(40),candidateImage: `ghcr.io/rhanka/sentropic-api@sha256:${'c'.repeat(64)}`,
  restoredBackupSha256: 'd'.repeat(64),candidateBootPassed: true,functionalAuthPassed: true,d11Passed: true,
  ...Object.fromEntries(STATE_HASHES.map(key => [key,'a'.repeat(64)])) });
test('original receipt validates every required field and rejects unknown keys or invalid references', () => {
  const original = qualifiedReceipt();
  assert.doesNotThrow(() => parseOriginalRehearsal(original));
  for (const key of Object.keys(original)) {
    const missing = { ...original }; delete missing[key]; assert.throws(() => parseOriginalRehearsal(missing),key);
  }
  for (const patch of [{ extra: true },{ isolatedRestoreRef: 'pending' },{ restoredBackupSha256: 'bad' },
    { candidateBootPassed: false },{ receiptRef: 'x'.repeat(513) }]) {
    assert.throws(() => parseOriginalRehearsal({ ...original,...patch }));
  }
  const fenced = fencedReceipt(original,{ ...original,sourceContentSha256: 'e'.repeat(64) },
    { allowedChanges: ['sourceContentSha256'],reviewRef: 'track:fenced-review' });
  assert.equal(fenced.restoredBackupSha256,original.restoredBackupSha256);
  assert.equal(fenced.isolatedRestoreRef,original.isolatedRestoreRef);
});
