import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const WORKFLOW = '../../../.github/workflows/security-scanner-image.yml';
const IDENTITY =
  'https://github.com/rhanka/sentropic/.github/workflows/security-scanner-image.yml@refs/heads/main';
const ISSUER = 'https://token.actions.githubusercontent.com';
const PACKAGE = 'ghcr.io/rhanka/sentropic-trivy';

const loadWorkflow = async () =>
  await readFile(new URL(WORKFLOW, import.meta.url), 'utf8');

test('should promote only through a manual reserved transaction on protected main', async () => {
  const text = await loadWorkflow();
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /transaction_id/);
  assert.doesNotMatch(text, /\n\s*push:/);
  assert.doesNotMatch(text, /\n\s*schedule:/);
  assert.doesNotMatch(text, /\n\s*pull_request(_target)?:/);
  assert.doesNotMatch(text, /workflow_call/);
  assert.match(text, /refs\/heads\/main/);
  assert.doesNotMatch(text, /source_sha|package_override|signer_override|environment_override|patch_url/i);
});

test('should separate builder, validator and publisher jobs with least-privilege tokens', async () => {
  const text = await loadWorkflow();
  for (const job of ['build-scanner-image', 'verify-scanner-image-publication', 'publish-scanner-image']) {
    assert.ok(text.includes(job), `missing job ${job}`);
  }
  assert.match(text, /id-token:\s*write/);
  const idTokenCount = (text.match(/id-token:\s*write/g) || []).length;
  assert.equal(idTokenCount, 1);
  assert.match(text, /packages:\s*write/);
  assert.match(text, /security-scanner-image-publish/);
  assert.doesNotMatch(text, /SEAT_|SECURITY_REVIEW_ATTESTOR|SEAT_ENVIRONMENT_WRITER/);
});

test('should bind the exact keyless publisher identity and the single package', async () => {
  const text = await loadWorkflow();
  assert.ok(text.includes(ISSUER));
  assert.ok(text.includes(IDENTITY));
  assert.ok(text.includes(PACKAGE));
  assert.doesNotMatch(text, /aquasec\/trivy/);
  assert.doesNotMatch(text, /secrets\.[A-Z_]*(PAT|TOKEN)/);
});

test('should keep the builder key-free without registry or seat credentials', async () => {
  const text = await loadWorkflow();
  const buildSection = text.slice(text.indexOf('build-scanner-image'));
  assert.ok(!/secrets\./.test(buildSection.slice(0, 2000)) || buildSection.includes('no-secrets'));
  assert.doesNotMatch(text, /docker\/login-action/);
  assert.match(text, /no gratis|key-free|without secrets/i);
});

test('should require the three receipt bindings for the identical measured artifact', async () => {
  const text = await loadWorkflow();
  for (const receipt of ['ScannerImageBuildReceiptV1', 'ScannerImageValidationReceiptV1',
    'ScannerImagePublicationReceiptV1']) {
    assert.ok(text.includes(receipt), `missing receipt ${receipt}`);
  }
  assert.match(text, /same-run|identical.*artifact/i);
});
