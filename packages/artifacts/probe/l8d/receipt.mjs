import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const suites = [
  ...['artifacts-commit-probe', 'artifacts-mcp-adapter', 'artifacts-provider-acceptance',
    'artifacts-finalization-authorization', 'artifacts-provider-failures']
    .map((name) => `api/tests/integration/${name}.spec.ts`),
  ...['commit-authorization', 'commit-failures', 'mcp-app-adapter']
    .map((name) => `packages/artifacts-host/src/${name}.test.ts`),
];
const hash = /^[a-f0-9]{64}$/;
export function verifyArchives(tuple, read = readFileSync) {
  assert.deepEqual(tuple.map((p) => `${p.name}@${p.version}`).sort(), [
    '@sentropic/artifacts@0.2.0', '@sentropic/cluster-mesh@0.22.0',
    '@sentropic/mcp-auth@0.2.2', '@sentropic/mcp-platform@0.4.0',
  ]);
  for (const archive of tuple) {
    const bytes = read(archive.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), archive.sha256, 'altered archive');
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, archive.integrity);
  }
}
export function validateSuite(suite) {
  assert.ok(suites.includes(suite.path), 'unknown suite');
  assert.match(suite.sourceSha256 ?? '', hash, 'missing test source identity');
  assert.equal(suite.gate, 1, 'acceptance gate must be enabled');
  assert.equal(suite.exitCode, 0, `failed command: ${suite.command}`);
  assert.ok(!suite.log.includes('[acceptance-disabled]'), 'disabled acceptance');
  const cases = suite.report.testResults.filter((t) => t.name.endsWith(`/${suite.path}`))
    .flatMap((t) => t.assertionResults);
  assert.ok(cases.length > 0, `zero cases: ${suite.path}`);
  assert.ok(cases.every((t) => t.status === 'passed'), `failed/skipped cases: ${suite.path}`);
  return cases.length;
}
export function aggregate(shards) {
  assert.deepEqual(shards.map((s) => s.lane).sort(), ['L8a', 'L8b', 'L8c', 'L8d']);
  assert.match(shards[0].sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(shards[0].tupleDigest, hash);
  for (const shard of shards) {
    assert.equal(shard.sourceCommit, shards[0].sourceCommit, 'source mismatch');
    assert.equal(shard.tupleDigest, shards[0].tupleDigest, 'archive tuple mismatch');
    assert.equal(shard.status, 'passed', `unqualified ${shard.lane}`);
  }
  return { status: 'passed', sourceCommit: shards[0].sourceCommit,
    tupleDigest: shards[0].tupleDigest, lanes: shards.map((s) => s.lane) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  verifyArchives(receipt.tuple);
  assert.equal(receipt.install.status, 'passed', 'strict full-Radar install failed');
  assert.equal(receipt.install.strictPeerDeps, true);
  assert.equal(receipt.smoke.status, 'passed', 'packed runtime/declaration smoke failed');
  assert.equal(receipt.imageSmoke.status, 'passed', 'built Radar image smoke not covered');
  assert.deepEqual(receipt.suites.map((s) => s.path).sort(), [...suites].sort());
  for (const suite of receipt.suites) validateSuite(suite);
  console.log(JSON.stringify(aggregate(receipt.shards)));
}
