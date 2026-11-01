import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  L08A_ROWS,
  LOADER_KINDS,
  validateProvisioningReceipt,
  loaderKindFor,
  CREDENTIAL_ROWS,
  LOADER_KIND_LIST,
  MAX_TOKEN_EXPIRY_DAYS,
  READER_ENVIRONMENTS,
  assertCredentialRows,
  crossCheckWorkflowEnvironments,
  assertProvisioningReceipt,
} from './control-provisioning.mjs';
import { L08A_ACCEPTANCE, validateDisposition } from './acceptance-disposition.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('L8-J: L08a provisioning rows and loader map', () => {
  it('L08a owns reader copies, deploy key and scan signer rows', () => {
    const kinds = L08A_ROWS.map((r) => r.loaderKind).sort();
    assert.deepEqual(kinds, ['control-reader', 'report-deploy-key', 'scan-permit-signer']);
  });

  it('loader map covers every section 4.5 credential without arbitrary names', () => {
    assert.equal(loaderKindFor('SECURITY_CONTROL_READER_TOKEN'), 'control-reader');
    assert.equal(loaderKindFor('SECURITY_REPORT_DEPLOY_KEY'), 'report-deploy-key');
    assert.equal(loaderKindFor('SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC'), 'scan-permit-signer');
    assert.equal(loaderKindFor('SEAT_ENVIRONMENT_WRITER_TOKEN'), 'seat-environment-writer');
    assert.equal(loaderKindFor('NOPE_UNKNOWN'), undefined);
    assert.ok(!Object.keys(LOADER_KINDS).includes('custom'));
  });

  it('receipt with a secret value fails; names-only receipt passes', () => {
    const good = {
      credential: 'SECURITY_REPORT_DEPLOY_KEY',
      copies: ['security-report-publish'],
      keyFingerprint: 'SHA256:abc',
      createdAt: Date.parse('2026-11-01T00:00:00Z'),
      expiresAt: Date.parse('2026-11-01T00:00:00Z') + 80 * 86400000,
      probes: [{ op: 'push-report-ref', result: 'allowed' }],
      loaderKind: 'report-deploy-key',
    };
    assert.deepEqual(validateProvisioningReceipt(good), []);
    assert.ok(validateProvisioningReceipt({ ...good, privateKey: 'secret-bytes' }).length > 0);
    assert.ok(
      validateProvisioningReceipt({ ...good, expiresAt: good.createdAt + 91 * 86400000 }).length > 0,
    );
  });
});

describe('T6-M1: L08a acceptance disposition is complete', () => {
  it('every L08a row has an owner, destination and suite', () => {
    const errors = validateDisposition(L08A_ACCEPTANCE);
    assert.deepEqual(errors, []);
  });

  it('no inherited row is closed as bare N/A', () => {
    for (const row of L08A_ACCEPTANCE) {
      assert.ok(row.disposition !== 'na', row.id);
      assert.ok(row.destinations.length > 0, row.id);
      assert.ok(row.suite === 'test-security-daily', row.id);
    }
  });
});

// T5-C6 / T6-M1 (r6 §6.4 D/ destination): §4.5 credential provisioning/copy/rotation
// receipts — ten rows, ≤90-day expiry where applicable, fixed loader kinds, names-only
// receipt validation, and the workflow environment cross-check against the C/ contract.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function baseReceipt(overrides = {}) {
  return {
    credentialId: 'SEAT_ENVIRONMENT_WRITER_TOKEN',
    credentialType: 'pat-fine-grained',
    principalId: 123456789,
    repositoryIds: [987654321],
    grantedPermissions: ['environments:write', 'metadata:read'],
    environmentNameCopies: ['security-seat-writer/SEAT_ENVIRONMENT_WRITER_TOKEN'],
    workflowStepAllowlist: ['security-seat.yml/state-write-allocate'],
    bundleDigest: 'a'.repeat(64),
    protectionDigest: 'b'.repeat(64),
    createdAt: '2026-11-01T00:00:00Z',
    expiresAt: '2026-12-31T00:00:00Z',
    nextRotationAt: '2026-12-01T00:00:00Z',
    probeResults: [{ probe: 'environment-put', result: 'allowed' }, { probe: 'repository-secret-read', result: 'denied' }],
    loaderKind: 'seat-environment-writer',
    loaderRevision: 'r6',
    oldCredentialRevoked: true,
    verificationRunIds: ['run-101'],
    outcome: 'accepted',
    ...overrides,
  };
}

test('T5-C6/T6-M1: the ten §4.5 credential rows are complete with owners, expiry rules, copies and loader kinds', () => {
  assert.equal(assertCredentialRows(), true);
  assert.equal(CREDENTIAL_ROWS.length, 10);
  assert.equal(LOADER_KIND_LIST.length, 10);
  const reader = CREDENTIAL_ROWS.find(r => r.credential === 'SECURITY_CONTROL_READER_TOKEN');
  assert.equal(reader.copies.length, 12);
  assert.deepEqual(reader.copies.map(c => c.split('/')[0]), READER_ENVIRONMENTS);
  const writer = CREDENTIAL_ROWS.find(r => r.credential === 'SEAT_ENVIRONMENT_WRITER_TOKEN');
  assert.equal(writer.expiry, '<=90d');
  assert.equal(MAX_TOKEN_EXPIRY_DAYS, 90);
});

test('T5-C6: a names-only provisioning receipt with ≤90-day expiry validates', () => {
  assert.equal(assertProvisioningReceipt(baseReceipt()), true);
});

test('T5-C6: receipt carrying secret material or a credential-derived digest refuses', () => {
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ secretValue: 'x' })), /receipt-secret-material/);
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ tokenDigest: 'c'.repeat(64) })), /receipt-digest-not-allowlisted/);
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ bundleDigest: 'not-a-digest' })), /receipt-digest-malformed/);
});

test('T5-C6: expiry beyond 90 days or rotation scheduled after expiry refuses', () => {
  assert.throws(
    () => assertProvisioningReceipt(baseReceipt({ expiresAt: '2027-02-01T00:00:00Z' })),
    /receipt-expiry-over-90d/,
  );
  assert.throws(
    () => assertProvisioningReceipt(baseReceipt({ expiresAt: '2026-12-31T00:00:00Z', nextRotationAt: '2027-01-15T00:00:00Z' })),
    /receipt-rotation-after-expiry/,
  );
});

test('T5-C6: malformed copies, missing revocation, unknown loader kind or non-accepted outcome refuse', () => {
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ environmentNameCopies: ['arbitrary name!'] })), /receipt-copy-malformed/);
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ oldCredentialRevoked: false })), /receipt-revocation-missing/);
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ loaderKind: 'app-installation' })), /receipt-loader-kind/);
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ outcome: 'pending' })), /receipt-outcome/);
  assert.throws(() => assertProvisioningReceipt(baseReceipt({ verificationRunIds: [] })), /receipt-verification/);
});

test('T6-M1: workflow cross-check — twelve reader copies match the C/ contract and no workflow uses a non-allowlisted security-* environment', () => {
  const counts = crossCheckWorkflowEnvironments(repoRoot);
  assert.equal(counts.readerEnvironments, 12);
  assert.ok(counts.jobEnvironments >= 12);
  assert.ok(counts.workflowEnvironments >= 0);
});
