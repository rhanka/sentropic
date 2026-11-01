import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEADLINE_SCHEMA,
  MAX_DEADLINE_JSON_BYTES,
  MAX_RECORDS,
  MAX_STRING_BYTES,
  deriveDeadlineKey,
  deriveReportId,
  validateDeadlineStatus,
  renderDeadlineMarkdown,
} from './report-format.mjs';

function positiveDoc() {
  const payload = {
    schemaId: 'DeadlineStatusV1',
    schemaVersion: 1,
    reportKind: 'deadline-status',
    repositoryId: 123,
    repositoryName: 'sentropic',
    asOfUtcDate: '2026-11-03',
    deadlineKey: deriveDeadlineKey(123, '2026-11-03'),
    producer: { scheduledFor: '2026-11-03T07:30:00Z', inventorySourceSha: 'a'.repeat(40) },
    status: { scanStatus: 'incomplete-scan', qualifyingForAbsence: false, fullScanPerformed: false, m1Status: 'blocked' },
    coverage: [],
    measurements: [],
    debt: [],
    units: [],
    observed: { admissions: [], merges: [] },
    publication: { publicationStatus: 'prepared', expectedTarget: 'security-reports', boundStatus: 'within-bound' },
  };
  return { ...payload, reportId: deriveReportId(payload) };
}

describe('L8-I: strict DeadlineStatusV1 schema', () => {
  it('positive fixture validates and keys recompute', () => {
    const doc = positiveDoc();
    assert.deepEqual(validateDeadlineStatus(doc, { repositoryAllowlist: ['sentropic'] }), []);
    assert.ok(doc.deadlineKey.startsWith('d1:'));
    assert.ok(doc.reportId.startsWith('ds1-'));
  });

  it('unknown fields and full-scan identity fields fail', () => {
    const doc = positiveDoc();
    assert.ok(validateDeadlineStatus({ ...doc, extra: 1 }, { repositoryAllowlist: ['sentropic'] }).length > 0);
    for (const field of ['scanKey', 'attemptOrdinal', 'executionAdmissionId', 'attemptKind', 'selectedAttemptOrdinal']) {
      assert.ok(validateDeadlineStatus({ ...doc, [field]: 'x' }, { repositoryAllowlist: ['sentropic'] }).length > 0, field);
    }
  });

  it('false complete, M1 credit, absence and stale-date claims fail', () => {
    const doc = positiveDoc();
    assert.ok(
      validateDeadlineStatus({ ...doc, status: { ...doc.status, scanStatus: 'complete-clean' } }, { repositoryAllowlist: ['sentropic'] }).length > 0,
    );
    assert.ok(
      validateDeadlineStatus({ ...doc, status: { ...doc.status, qualifyingForAbsence: true } }, { repositoryAllowlist: ['sentropic'] }).length > 0,
    );
    assert.ok(validateDeadlineStatus({ ...doc, asOfUtcDate: '2026-11-02' }, { repositoryAllowlist: ['sentropic'] }).length > 0);
  });

  it('wrong date format, caller URL and active content fail', () => {
    const doc = positiveDoc();
    assert.ok(validateDeadlineStatus({ ...doc, asOfUtcDate: '11/03/2026' }, { repositoryAllowlist: ['sentropic'] }).length > 0);
    const withUrl = { ...positiveDoc(), publication: { publicationStatus: 'prepared', expectedTarget: 'https://evil.example/x', boundStatus: 'within-bound' } };
    assert.ok(validateDeadlineStatus(withUrl, { repositoryAllowlist: ['sentropic'] }).length > 0);
    const withScript = { ...positiveDoc(), units: [{ note: '<script>alert(1)</script>' }] };
    assert.ok(validateDeadlineStatus(withScript, { repositoryAllowlist: ['sentropic'] }).length > 0);
  });

  it('oversize input becomes report-bound, never silent truncation', () => {
    const doc = positiveDoc();
    const big = { ...doc, measurements: new Array(MAX_RECORDS + 1).fill({ id: 'm' }) };
    const errors = validateDeadlineStatus(big, { repositoryAllowlist: ['sentropic'] });
    assert.ok(errors.some((e) => e.includes('report-bound')));
    assert.equal(MAX_DEADLINE_JSON_BYTES, 4 * 1024 * 1024);
    assert.equal(MAX_STRING_BYTES, 4 * 1024);
  });
});

describe('L8-I: deterministic renderer order', () => {
  it('renders the eight fixed sections in order with escaped data', () => {
    const md = renderDeadlineMarkdown(positiveDoc());
    const sections = [
      'Coverage',
      'Provenance',
      'Missing gates',
      'Debt and expiry',
      'Manual assignments',
      'Admissions and merges',
      'Shortfall',
      'Next due',
    ];
    let cursor = -1;
    for (const title of sections) {
      const at = md.indexOf(`## ${title}`);
      assert.ok(at > cursor, title);
      cursor = at;
    }
    assert.ok(!md.includes('<script>'));
  });
});
