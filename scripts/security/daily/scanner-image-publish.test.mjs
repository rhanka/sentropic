import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { receiptFixture } from '../scanner/receipt-fixture.mjs';
import { validateReceiptContract } from '../scanner/receipt-contract.mjs';
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
  const emittedNames = Object.values(jobs).flatMap(job => job.steps.map(step => step.run ?? '')).join('\n');
  assert.match(emittedNames, /echo "ScannerImageBuildReceiptV1/);
  assert.throws(() => validateReceiptContract({ ...receiptFixture(), receipts: emittedNames,
    artifactBytes: Buffer.alloc(0), outputs: {} }), /scanner-contract/);
});
