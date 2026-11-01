import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quarantineScan, validatePublicLink } from './report-transfer.mjs';

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
