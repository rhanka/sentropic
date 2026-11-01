import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { digest, isDigest } from './toolchain-contract.mjs';
import { publishEvidence, quarantineScan, validatePublicLink, validateReportStorageIndependence, validateTransferBudget, validateTransferManifest, validateTransferReceipt } from './report-transfer.mjs';

describe('L8-C: synthetic leaks are withheld and quarantined', () => {
  it('withholds secrets hidden in findings, filenames, raw output and logs', () => {
    const payload = {
      findings: [{ title: 'x', detail: 'token ghp_abcdef1234567890 here' }],
      files: ['reports/ok.json', '../../etc/passwd', '/abs/path.json'],
      rawOutput: '-----BEGIN RSA PRIVATE KEY-----\nfake\n',
      logs: ['key=AKIAIOSFODNN7EXAMPLE leaked'],
    };
    const result = quarantineScan(payload);
    assert.equal(result.safe, false);
    assert.ok(result.withheld.length >= 4);
    for (const hit of result.withheld) {
      assert.ok(typeof hit.location === 'string' && typeof hit.reason === 'string');
    }
  });

  it('clean public payload passes without withheld entries', () => {
    const result = quarantineScan({ findings: [{ title: 'ok', detail: 'nothing sensitive' }], files: ['reports/a.json'] });
    assert.equal(result.safe, true);
    assert.deepEqual(result.withheld, []);
  });

  it('invalid output becomes incomplete status with no payload', () => {
    const result = quarantineScan(null);
    assert.equal(result.safe, false);
    assert.equal(result.status, 'incomplete-scan');
    assert.equal(result.payload, undefined);
  });
});

describe('L8-C: anonymous data-only public access', () => {
  it('accepts only fixed GitHub origins for this repository', () => {
    assert.deepEqual(validatePublicLink('https://github.com/rhanka/sentropic/blob/security-reports/reports/a.json'), []);
    assert.deepEqual(validatePublicLink('https://raw.githubusercontent.com/rhanka/sentropic/refs/heads/security-reports/a.json'), []);
    assert.ok(validatePublicLink('https://evil.example/reports/a.json').length > 0);
    assert.ok(validatePublicLink('https://github.com/other/repo/blob/main/a.json').length > 0);
  });
});

// ACT-L05 (r6 wave W2): L5-D bounded transfer receipts, L5-E measured
// transfer/storage bounds. Synthetic chunks only; nothing is published.
const chunk = (name, data, overrides = {}) => ({ name, data, digest: digest(data), type: 'file', ...overrides });
const manifestFor = (chunks) => ({ schemaVersion: 1, count: chunks.length,
  totalBytes: chunks.reduce((total, entry) => total + Buffer.byteLength(entry.data), 0),
  manifestDigest: digest(chunks.map((entry) => entry.digest).join('|')) });

describe('L5-D: bounded chunked transfer refuses hostile or partial uploads', () => {
  it('accepts a complete verified chunk set', () => {
    const chunks = [chunk('reports/a.json', '{"a":1}'), chunk('reports/b.json', '{"b":2}')];
    const manifest = manifestFor(chunks);
    assert.equal(validateTransferManifest({ chunks, manifest }), true);
  });

  it('refuses altered, missing, partial, oversize, symlink and traversal chunks', () => {
    const chunks = [chunk('reports/a.json', '{"a":1}'), chunk('reports/b.json', '{"b":2}')];
    const manifest = manifestFor(chunks);
    const altered = [{ ...chunks[0], data: '{"a":2}' }, chunks[1]];
    assert.throws(() => validateTransferManifest({ chunks: altered, manifest }), /altered chunk/);
    assert.throws(() => validateTransferManifest({ chunks: [chunks[0]], manifest }), /missing chunk/);
    assert.throws(() => validateTransferManifest({ chunks: [...chunks, chunk('reports/c.json', 'x')], manifest }), /unexpected chunk/);
    assert.throws(() => validateTransferManifest({ chunks: [chunk('reports/a.json', 'x'.repeat(1048577)), chunks[1]], manifest }), /chunk byte bound/);
    assert.throws(() => validateTransferManifest({ chunks: [chunk('../../etc/passwd', 'x'), chunks[1]], manifest }), /filename/);
    assert.throws(() => validateTransferManifest({ chunks: [chunk('/abs', 'x'), chunks[1]], manifest }), /filename/);
    assert.throws(() => validateTransferManifest({ chunks: [chunk('link', 'x', { type: 'symlink', target: '/etc/passwd' }), chunks[1]], manifest }), /symlink/);
    const forgedManifest = { ...manifest, manifestDigest: digest('forged') };
    assert.throws(() => validateTransferManifest({ chunks, manifest: forgedManifest }), /manifest digest/);
    assert.throws(() => validateTransferManifest({ chunks: [], manifest }), /missing chunk/);
  });
});

describe('L5-D: transfer receipts must come from the trusted collector with separate scan writes', () => {
  const producer = { runId: '40876641000', runAttempt: 1, job: 'build-api-image' };
  const receipt = (overrides = {}) => {
    const base = { schemaVersion: 1, collector: 'deploy-key', scanRole: 'scan-supervisor',
      producer, sourceControlled: false, publishedPaths: ['reports/a.json'] };
    base.receiptHash = digest(JSON.stringify(base));
    return { ...base, ...overrides };
  };

  it('accepts a verified collector receipt with distinct scan role', () => {
    assert.equal(validateTransferReceipt(receipt(), { expectedProducer: producer }), true);
  });

  it('refuses forged, swapped, source-controlled or non-separate receipts', () => {
    assert.throws(() => validateTransferReceipt({ ...receipt(), receiptHash: digest('forged') }, { expectedProducer: producer }), /forged/);
    assert.throws(() => validateTransferReceipt(receipt({ producer: { ...producer, runAttempt: 2 } }), { expectedProducer: producer }), /run\/attempt/);
    assert.throws(() => validateTransferReceipt(receipt({ sourceControlled: true }), { expectedProducer: producer }), /source-controlled/);
    assert.throws(() => validateTransferReceipt(receipt({ collector: 'actions-bot' }), { expectedProducer: producer }), /collector/);
    assert.throws(() => validateTransferReceipt(receipt({ scanRole: 'deploy-key' }), { expectedProducer: producer }), /separate/);
  });

  it('publishes complete evidence only when quarantine, manifest and receipt all pass', () => {
    const chunks = [chunk('reports/a.json', '{"findings":[]}')];
    const manifest = manifestFor(chunks);
    const good = publishEvidence({ payload: { findings: [] }, chunks, manifest, receipt: receipt(), producer });
    assert.equal(good.published, true);
    assert.deepEqual(good.publishedPaths, ['reports/a.json']);
    const leaked = publishEvidence({ payload: { findings: [{ detail: 'ghp_abcdef1234567890' }] }, chunks, manifest, receipt: receipt(), producer });
    assert.equal(leaked.published, false);
    assert.equal(leaked.status, 'incomplete-scan');
    assert.deepEqual(leaked.publishedPaths, []);
    const partial = publishEvidence({ payload: { findings: [] }, chunks: [chunks[0]], manifest: manifestFor([chunks[0], chunk('reports/b.json', 'x')]), receipt: receipt(), producer });
    assert.equal(partial.published, false);
    assert.equal(partial.status, 'incomplete-scan');
    const forged = publishEvidence({ payload: { findings: [] }, chunks, manifest, receipt: { ...receipt(), receiptHash: digest('nope') }, producer });
    assert.equal(forged.published, false);
  });
});

describe('L5-E: transfer/storage measurement refuses unknown entitlement, low headroom or paid overage', () => {
  it('records actual transfer/extraction/disk/storage use on a measured no-overage entitlement', () => {
    const measurement = validateTransferBudget({ transferredBytes: 1024, extractionBytes: 4096, diskBytes: 8192,
      storageBytes: 2048, entitlement: 'measured-no-overage', headroomBytes: 1048576, paidOverageExposure: false });
    assert.equal(measurement.transferredBytes, 1024);
    assert.equal(measurement.extractionBytes, 4096);
    assert.equal(measurement.diskBytes, 8192);
    assert.equal(measurement.storageBytes, 2048);
    assert.ok(isDigest(measurement.measurementHash));
    assert.equal(typeof measurement.recordedAt, 'string');
  });

  it('refuses before transfer on unknown entitlement, insufficient headroom or paid-overage exposure', () => {
    const base = { transferredBytes: 1024, extractionBytes: 4096, diskBytes: 8192, storageBytes: 2048,
      entitlement: 'measured-no-overage', headroomBytes: 1048576, paidOverageExposure: false };
    for (const [name, delta] of [
      ['unknown entitlement', { entitlement: 'unknown' }],
      ['missing entitlement', { entitlement: undefined }],
      ['insufficient headroom', { headroomBytes: 512 }],
      ['zero headroom', { headroomBytes: 0 }],
      ['paid overage exposure', { paidOverageExposure: true }],
    ]) {
      assert.throws(() => validateTransferBudget({ ...base, ...delta }), /coverage-blocked/, name);
    }
  });

  it('qualifies public report storage independently of seat-store access', () => {
    assert.equal(validateReportStorageIndependence({ reportRef: 'refs/heads/security-reports', seatStoreAccess: false }), true);
    assert.throws(() => validateReportStorageIndependence({ reportRef: 'refs/heads/main', seatStoreAccess: false }), /report ref/);
    assert.throws(() => validateReportStorageIndependence({ reportRef: 'refs/heads/security-reports', seatStoreAccess: true }), /seat-store/);
  });
});
