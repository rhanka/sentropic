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
import { assessChain, assessReleaseReceipt } from './release-receipt.mjs';

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

for (const status of ['skipped', 'absent']) {
  test(`rejects an expected publication concluded ${status}`, () => {
    const evidence = base();
    evidence.publications[0].status = status;
    const verdict = assessReleaseReceipt(evidence);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /missing publication: sentropic-api/);
  });
}

test('rejects a failed publication', () => {
  const evidence = base();
  evidence.publications[0].status = 'failed';
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /publication failed: sentropic-api/);
});

test('rejects an expected package publication repacked instead of candidate-sourced', () => {
  const evidence = base();
  evidence.publications.push({
    kind: 'package', name: '@sentropic/llm-mesh', ref: '0.33.0', expected: true,
    source: sha, digest, expectedDigest: digest, status: 'published', remoteDigest: digest, pack: 'fresh',
  });
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /repacked publication: @sentropic\/llm-mesh/);
});

test('rejects an expected package publication with no recorded pack source', () => {
  const evidence = base();
  evidence.publications.push({
    kind: 'package', name: '@sentropic/llm-mesh', ref: '0.33.0', expected: true,
    source: sha, digest, expectedDigest: digest, status: 'published', remoteDigest: digest,
  });
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /repacked publication: @sentropic\/llm-mesh/);
});

test('accepts an expected package publication sourced from the candidate', () => {
  const evidence = base();
  evidence.publications.push({
    kind: 'package', name: '@sentropic/llm-mesh', ref: '0.33.0', expected: true,
    source: sha, digest, expectedDigest: digest, status: 'published', remoteDigest: digest, pack: 'candidate',
  });
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
});

test('rejects mismatched registry integrity', () => {
  const evidence = base();
  evidence.publications[0].integrity = 'sha512-AAA';
  evidence.publications[0].registryIntegrity = 'sha512-BBB';
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /mismatched registry integrity for sentropic-api/);
});

test('rejects provenance naming another source commit', () => {
  const evidence = base();
  evidence.publications[0].provenance = { sourceCommits: ['e'.repeat(40)], runId: '4242' };
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /mismatched provenance source for sentropic-api/);
});

test('rejects provenance from a stale run', () => {
  const evidence = base();
  evidence.publications[0].provenance = { sourceCommits: [sha], runId: '9999' };
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /stale provenance run for sentropic-api/);
});

test('rejects a reused receipt from another run', () => {
  const evidence = base();
  evidence.prior = { sourceSha: sha, runId: '9999', attempt: '1' };
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /stale receipt reuse/);
});

test('rejects a reused receipt from another source', () => {
  const evidence = base();
  evidence.prior = { sourceSha: 'd'.repeat(40), runId: '4242', attempt: '1' };
  const verdict = assessReleaseReceipt(evidence);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /stale receipt reuse/);
});

const cli = fileURLToPath(new URL('./release-receipt.mjs', import.meta.url));
function runCli(evidence, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-receipt-'));
  const file = path.join(dir, 'evidence.json');
  fs.writeFileSync(file, JSON.stringify(evidence));
  try {
    const output = execFileSync(process.execPath, [cli, 'assess', '--evidence', file, '--out', path.join(dir, 'receipt.json'), ...extra],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output, receipt: JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8')) };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}`, receipt: null };
  }
}

test('CLI assesses valid evidence with exit 0 and writes the receipt', () => {
  const result = runCli(base());
  assert.equal(result.status, 0, result.output);
  assert.equal(result.receipt.ok, true);
  assert.match(result.output, /release-receipt: PASS/);
});

test('CLI fails closed with ::error lines on a broken release', () => {
  const evidence = base();
  evidence.checks.find((row) => row.job === 'publish-api-image').conclusion = 'failure';
  const result = runCli(evidence);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /::error::/);
  assert.match(result.output, /required check publish-api-image concluded failure/);
});

// ---- delivery-chain assessment (release-receipts CI job input shape)
const chainNeeds = (results, outputs = {}) => Object.fromEntries(
  Object.entries(results).map(([job, result]) => [job, { result, outputs: outputs[job] ?? {} }]));
const chainSelections = (overrides = {}) => ({
  api: false, ui: false, global: false, meshPublish: false, gatewayPublish: false, clusterPublish: false, ...overrides,
});
const chainSource = () => ({ sha, runId: '4242', attempt: '1' });

test('chain accepts a complete delivery of tested bytes', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'success', 'publish-ui-image': 'success',
      'publish-llm-mesh': 'success', 'publish-llm-gateway': 'success',
      'publish-cluster-mesh': 'success', 'verify-train-lock-integrity': 'success',
    }, {
      'publish-llm-mesh': { name: '@sentropic/llm-mesh', version: '0.33.0', status: 'published', sha256: 'b'.repeat(64), pack: 'candidate' },
      'publish-llm-gateway': { name: '@sentropic/llm-gateway', version: '0.22.4', status: 'published', sha256: 'b'.repeat(64), pack: 'candidate' },
      'publish-cluster-mesh': { name: '@sentropic/cluster-mesh', version: '0.2.9', status: 'published', sha256: 'c'.repeat(64), pack: 'candidate' },
    }),
    selections: chainSelections({ api: true, ui: true, meshPublish: true, gatewayPublish: true, clusterPublish: true }),
    source: chainSource(),
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
  const cluster = verdict.evidence.publications.find((row) => row.name === '@sentropic/cluster-mesh');
  assert.equal(cluster.digest, `sha256:${'c'.repeat(64)}`);
  assert.equal(cluster.pack, 'candidate');
});

test('chain accepts an overlay-only run with every delivery job skipped', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'skipped', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'skipped',
    }),
    selections: chainSelections(),
    source: chainSource(),
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
});

test('chain rejects a repacked package publication even when the publisher succeeded', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'success', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'success',
    }, {
      'publish-llm-mesh': { name: '@sentropic/llm-mesh', version: '0.33.0', status: 'published', sha256: 'b'.repeat(64), pack: 'fresh' },
    }),
    selections: chainSelections({ meshPublish: true }),
    source: chainSource(),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /repacked publication: @sentropic\/llm-mesh/);
});

test('chain reads the production publication_pack output key', () => {
  const accepted = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'success', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'success',
    }, {
      'publish-llm-mesh': { publication_pack: 'candidate' },
    }),
    selections: chainSelections({ meshPublish: true }),
    source: chainSource(),
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.problems));
  const rejected = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'success', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'success',
    }, {
      'publish-llm-mesh': { publication_pack: 'fresh' },
    }),
    selections: chainSelections({ meshPublish: true }),
    source: chainSource(),
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.problems.join('\n'), /repacked publication: @sentropic\/llm-mesh/);
});

test('chain rejects a selected package publication with no recorded pack source', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'success', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'success',
    }, {
      'publish-llm-mesh': { name: '@sentropic/llm-mesh', version: '0.33.0', status: 'published', sha256: 'b'.repeat(64) },
    }),
    selections: chainSelections({ meshPublish: true }),
    source: chainSource(),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /repacked publication: @sentropic\/llm-mesh/);
});

test('chain rejects a selected image publication that stayed skipped', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'skipped', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'skipped',
    }),
    selections: chainSelections({ api: true }),
    source: chainSource(),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /missing publication: sentropic-api/);
});

test('chain rejects a failed publisher', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'failure', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'skipped', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'skipped',
    }),
    selections: chainSelections({ api: true }),
    source: chainSource(),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /required check publish-api-image concluded failure/);
});

test('chain never blocks on a missing train-lock entry (BRDP-EX10 pin)', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'success', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped',
    }, {
      'publish-llm-mesh': { name: '@sentropic/llm-mesh', version: '0.33.0', status: 'published', sha256: 'b'.repeat(64), pack: 'candidate' },
    }),
    selections: chainSelections({ meshPublish: true }),
    source: chainSource(),
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
});

test('chain rejects a supplied failing train-lock check while the train published', () => {
  const verdict = assessChain({
    needs: chainNeeds({
      'publish-api-image': 'skipped', 'publish-ui-image': 'skipped',
      'publish-llm-mesh': 'success', 'publish-llm-gateway': 'skipped',
      'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'failure',
    }, {
      'publish-llm-mesh': { name: '@sentropic/llm-mesh', version: '0.33.0', status: 'published', sha256: 'b'.repeat(64), pack: 'candidate' },
    }),
    selections: chainSelections({ meshPublish: true }),
    source: chainSource(),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join('\n'), /required check verify-train-lock-integrity concluded failure/);
});

test('CLI assess-chain builds evidence from a needs file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-chain-'));
  const needsFile = path.join(dir, 'needs.json');
  fs.writeFileSync(needsFile, JSON.stringify(chainNeeds({
    'publish-api-image': 'success', 'publish-ui-image': 'skipped',
    'publish-llm-mesh': 'skipped', 'publish-llm-gateway': 'skipped',
    'publish-cluster-mesh': 'skipped', 'verify-train-lock-integrity': 'skipped',
  })));
  const outFile = path.join(dir, 'receipt.json');
  const output = execFileSync(process.execPath, [cli, 'assess-chain', '--needs', needsFile,
    '--sha', sha, '--run-id', '4242', '--attempt', '1',
    '--api', 'true', '--ui', 'false', '--global', 'false',
    '--mesh-publish', 'false', '--gateway-publish', 'false', '--cluster-publish', 'false',
    '--out', outFile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(output, /release-receipt: PASS/);
  const receipt = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.evidence.source.sha, sha);
});
