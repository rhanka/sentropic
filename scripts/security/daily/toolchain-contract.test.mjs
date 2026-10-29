import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQualified, policy, validateFreshness } from './toolchain-contract.mjs';

const now = Date.parse('2026-10-29T12:00:00Z');
const metadata = () => ({ Version: 2, UpdatedAt: '2026-10-29T06:00:00Z',
  NextUpdate: '2026-10-30T06:00:00Z', DownloadedAt: '2026-10-29T11:00:00Z' });
test('should reject stale, future, malformed and incompatible DB metadata', () => {
  assert.equal(validateFreshness(metadata(), 2, now).Version, 2);
  for (const delta of [{ Version: 1 }, { UpdatedAt: '2026-10-27T06:00:00Z' },
    { UpdatedAt: '2026-10-29T12:01:00Z' }, { NextUpdate: '2026-10-29T11:59:59Z' },
    { DownloadedAt: '2026-10-29T12:01:00Z' }, { UpdatedAt: null }, { NextUpdate: 'invalid' },
    { DownloadedAt: '2026-10-29T11:00:00' }]) {
    assert.throws(() => validateFreshness({ ...metadata(), ...delta }, 2, now), /coverage-blocked/);
  }
  assert.throws(() => validateFreshness(metadata(), 2, Date.parse('2026-10-30T06:00:01Z')), /coverage-blocked/);
});
test('should keep daily qualification blocked despite valid version and frozen pins', () => {
  assert.equal(policy.option, 'B');
  assert.equal(policy.qualified, false);
  assert.throws(() => assertQualified(), /S2b qualification pending/);
});
