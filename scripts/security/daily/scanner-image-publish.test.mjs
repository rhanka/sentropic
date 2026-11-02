import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { receiptFixture } from '../scanner/receipt-fixture.mjs';
import { validateReceiptContract } from '../scanner/receipt-contract.mjs';
import { digest } from './toolchain-contract.mjs';
const { parse } = createRequire(`${process.env.MANIFEST_GUARD_TOOL_DIR}/package.json`)('yaml');

const WORKFLOW = '../../../.github/workflows/security-scanner-image.yml';
const IDENTITY =
  'https://github.com/rhanka/sentropic/.github/workflows/security-scanner-image.yml@refs/heads/main';
const ISSUER = 'https://token.actions.githubusercontent.com';
const PACKAGE = 'ghcr.io/rhanka/sentropic-trivy';

const loadWorkflow = async () =>
  await readFile(new URL(WORKFLOW, import.meta.url), 'utf8');

test('should promote only through a manual reserved transaction on protected main', async () => {
  const workflow = parse(await loadWorkflow());
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs, {
    transaction_id: { description: 'Opaque reserved maintenance transaction referencing the reviewed recipe',
      required: true, type: 'string' },
  });
  assert.deepEqual(workflow.permissions, {});
});

test('should separate builder, validator and publisher jobs with least-privilege tokens', async () => {
  const { jobs } = parse(await loadWorkflow());
  assert.deepEqual(Object.keys(jobs), ['build-scanner-image', 'verify-scanner-image-publication', 'publish-scanner-image']);
  assert.deepEqual(jobs['build-scanner-image'].permissions, {});
  assert.deepEqual(jobs['verify-scanner-image-publication'].permissions, {});
  assert.equal(jobs['verify-scanner-image-publication'].needs, 'build-scanner-image');
  assert.equal(jobs['publish-scanner-image'].needs, 'verify-scanner-image-publication');
  assert.deepEqual(jobs['publish-scanner-image'].permissions, { packages: 'write', actions: 'read', 'id-token': 'write' });
  assert.equal(jobs['publish-scanner-image'].environment, 'security-scanner-image-publish');
});

test('should bind the exact keyless publisher identity and the single package', async () => {
  const { jobs } = parse(await loadWorkflow());
  const env = jobs['publish-scanner-image'].steps.at(-1).env;
  assert.equal(env.EXPECTED_ISSUER, ISSUER);
  assert.equal(env.EXPECTED_IDENTITY, IDENTITY);
  assert.equal(env.PUBLISH_TARGET, PACKAGE);
});

test('should keep the builder key-free without registry or seat credentials', async () => {
  const { jobs } = parse(await loadWorkflow());
  for (const name of ['build-scanner-image', 'verify-scanner-image-publication']) {
    assert.doesNotMatch(JSON.stringify(jobs[name]), /secrets\.|docker login|login-action|id-token/);
  }
});

test('should validate the complete synthetic chain only as a contract', () => {
  assert.deepEqual(validateReceiptContract(receiptFixture()), { contractValid: true, productionAdmitted: false });
});

test('should refuse receipt-name echoes as a substitute for produced receipts and artifacts', async () => {
  const { jobs } = parse(await loadWorkflow());
  const directory = await mkdtemp(join(tmpdir(), 'scanner-noop-'));
  try {
    // Only the two key-free receipt emitters; never execute the publisher/login.
    for (const name of ['build-scanner-image', 'verify-scanner-image-publication']) {
      const step = jobs[name].steps.at(-1);
      assert.match(step.run, /^\s*echo "ScannerImage/m);
      const stdout = execFileSync('/bin/sh', ['-eu', '-c', step.run], { cwd: directory, env: {}, encoding: 'utf8' });
      assert.match(stdout, /ScannerImage(?:Build|Validation)ReceiptV1/);
    }
    assert.deepEqual(await readdir(directory), []);
    assert.throws(() => validateReceiptContract({ ...receiptFixture(), receipts: {},
      artifactBytes: Buffer.alloc(0), outputs: {} }), /scanner-contract/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function relink(f) {
  f.receipts.validation.buildReceiptDigest = digest(JSON.stringify(f.receipts.build));
  f.receipts.publication.buildReceiptDigest = f.receipts.validation.buildReceiptDigest;
  f.receipts.publication.validationReceiptDigest = digest(JSON.stringify(f.receipts.validation));
}

test('should refuse missing, empty or altered artifacts and mismatched receipt bindings', () => {
  for (const mutate of [
    f => { f.artifactBytes = Buffer.alloc(0); },
    f => { f.artifactBytes = Buffer.from('substituted artifact'); },
    f => { f.outputs.trivy = Buffer.from('changed binary'); },
    f => { delete f.outputs['sbom.json']; },
    f => { f.receipts.validation.artifact.id++; },
    f => { f.receipts.validation.attempt++; },
    f => { f.receipts.validation.runId++; },
    f => { f.receipts.publication.repositoryId++; },
    f => { f.receipts.build.upstream.commit = 'b'.repeat(40); },
    f => { f.receipts.build.patchDigests.reverse(); },
    f => { f.receipts.build.reproducibility.second.binaryDigest = digest('other'); },
    f => { f.receipts.validation.publicationEligible = false; },
    f => { f.receipts.validation.checks.noExecution = false; },
    f => { f.receipts.validation.expiresAt = '2026-11-02T09:00:00Z'; },
    f => { f.receipts.publication.signing.sourceCommit = 'b'.repeat(40); },
    f => { f.receipts.publication.anonymousPullDigest = digest('other'); },
    f => { f.receipts.publication.package = 'ghcr.io/other/scanner'; },
    f => { f.receipts.publication.signing.identity = 'https://example.org'; },
    f => { f.receipts.build.materialDigest = digest('other manifest'); },
    f => { f.receipts.build.artifact.files = []; },
    f => { f.receipts.build.failures = ['failed']; },
    f => { f.receipts.validation.skips = ['skipped']; },
    f => { f.receipts.publication.tokenInvalidated = false; },
    f => { f.receipts.build.startedAt = '2026-02-30T10:00:00Z'; },
  ]) {
    const fixture = receiptFixture(); mutate(fixture); relink(fixture);
    assert.throws(() => validateReceiptContract(fixture), /scanner-contract/);
  }
});

test('should refuse malformed measured OCI JSON even with recomputed receipt links', () => {
  for (const content of ['null', '[]', '{"manifests":{}}', '{']) {
    const fixture = receiptFixture(); const bytes = Buffer.from(content);
    fixture.outputs['index.json'] = bytes;
    for (const receipt of Object.values(fixture.receipts)) {
      const descriptor = { path: 'index.json', size: bytes.length, digest: digest(bytes) };
      receipt.chain.index = descriptor; receipt.artifact.files[0] = descriptor;
    }
    relink(fixture);
    assert.throws(() => validateReceiptContract(fixture), /scanner-contract/);
  }
});

test('should reject unknown or missing fields in each versioned receipt', () => {
  for (const name of ['build', 'validation', 'publication']) {
    for (const key of Object.keys(receiptFixture().receipts[name])) {
      const fixture = receiptFixture(); delete fixture.receipts[name][key];
      assert.throws(() => validateReceiptContract(fixture), /scanner-contract/, `${name}.${key}`);
    }
    const fixture = receiptFixture(); fixture.receipts[name].admitted = true; relink(fixture);
    assert.throws(() => validateReceiptContract(fixture), /scanner-contract/);
  }
});
