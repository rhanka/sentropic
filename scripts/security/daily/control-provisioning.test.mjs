import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  L08A_ROWS,
  LOADER_KINDS,
  validateProvisioningReceipt,
  loaderKindFor,
} from './control-provisioning.mjs';
import { L08A_ACCEPTANCE, validateDisposition } from './acceptance-disposition.mjs';

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
