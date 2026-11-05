// Release receipt verdict: the CD joins only tested bytes (plan BR-82 Lot 1).
// Rejects missing/failed/cancelled/skipped required checks, wrong source/digest,
// missing publication, tag collision, mismatched registry integrity/provenance,
// and stale receipt reuse.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessReleaseReceipt } from './release-receipt.mjs';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const otherDigest = `sha256:${'c'.repeat(64)}`;
const base = () => ({
  source: { sha, runId: '4242', attempt: '1' },
  requiredChecks: [{ job: 'test-api-unit-integration' }, { job: 'publish-api-image' }],
  checks: [
    { job: 'test-api-unit-integration', conclusion: 'success' },
    { job: 'publish-api-image', conclusion: 'success' },
  ],
  publications: [{
    kind: 'image', name: 'sentropic-api', ref: 'abc123', expected: true,
    source: sha, digest, expectedDigest: digest, status: 'published', remoteDigest: digest,
  }],
  prior: null,
});

test('accepts a fully qualified release of tested bytes', () => {
  const verdict = assessReleaseReceipt(base());
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
  assert.deepEqual(verdict.problems, []);
});

test('accepts an overlay-only run with nothing to release', () => {
  const verdict = assessReleaseReceipt({
    source: { sha, runId: '4242', attempt: '1' },
    requiredChecks: [], checks: [], publications: [], prior: null,
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
});

test('rejects a missing required check', () => {
  const evidence = base();
  evidence.checks = evidence.checks.filter((row) => row.job !== 'publish-api-image');
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /missing required check: publish-api-image/);
});

for (const conclusion of ['failure', 'cancelled', 'skipped']) {
  test(`rejects a required check concluded ${conclusion}`, () => {
    const evidence = base();
    evidence.checks.find((row) => row.job === 'publish-api-image').conclusion = conclusion;
    const verdict = assessReleaseReceipt(evidence);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), new RegExp(`required check publish-api-image concluded ${conclusion}`));
  });
}

test('rejects a publication from the wrong source', () => {
  const evidence = base();
  evidence.publications[0].source = 'd'.repeat(40);
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /wrong source for sentropic-api/);
});

test('rejects a published digest that differs from the tested bytes', () => {
  const evidence = base();
  evidence.publications[0].digest = otherDigest;
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /digest mismatch for sentropic-api/);
});

test('rejects a malformed published digest', () => {
  const evidence = base();
  evidence.publications[0].digest = 'not-a-digest';
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /invalid digest for sentropic-api/);
});

test('rejects a tag collision with different remote bytes', () => {
  const evidence = base();
  evidence.publications[0].remoteDigest = otherDigest;
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /tag collision for sentropic-api/);
});
