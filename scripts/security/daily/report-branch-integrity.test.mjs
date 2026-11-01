import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_REF,
  ALLOWED_PATH_PREFIXES,
  MAX_CAS_ATTEMPTS,
  ROTATION_MAX_DAYS,
  validatePushRequest,
  casAdvance,
  rotationDue,
  verifyRotation,
} from './report-branch-integrity.mjs';

const base = {
  ref: REPORT_REF,
  paths: ['reports/2026-11-03/ds1-abc/index.json'],
  force: false,
  expectedParent: 'p0',
  actualParent: 'p0',
  actor: 'deploy-key',
};

describe('T5-C4: dedicated deploy key performs a bounded non-forced update', () => {
  it('positive synthetic push advances exactly one confirmed state', () => {
    assert.deepEqual(validatePushRequest(base), []);
  });

  it('other writers and workflow tokens cannot update the report ref', () => {
    for (const actor of ['workflow-token', 'admin-session', 'publisher-app', 'merger-app']) {
      const errors = validatePushRequest({ ...base, actor });
      assert.ok(errors.length > 0, actor);
    }
  });

  it('force push and deletion fail', () => {
    assert.ok(validatePushRequest({ ...base, force: true }).length > 0);
    assert.ok(validatePushRequest({ ...base, paths: [], deleteRef: true }).length > 0);
  });

  it('collector cannot write main or non-report refs', () => {
    assert.ok(validatePushRequest({ ...base, ref: 'refs/heads/main' }).length > 0);
    assert.ok(validatePushRequest({ ...base, ref: 'refs/tags/v1' }).length > 0);
    assert.ok(validatePushRequest({ ...base, ref: 'refs/heads/feature-x' }).length > 0);
  });

  it('workflow paths, symlinks and out-of-scope paths fail', () => {
    assert.ok(validatePushRequest({ ...base, paths: ['.github/workflows/x.yml'] }).length > 0);
    assert.ok(validatePushRequest({ ...base, paths: ['reports/x', { symlink: true }] }).length > 0);
    assert.ok(validatePushRequest({ ...base, paths: ['src/evil.mjs'] }).length > 0);
  });
});

describe('L8-D: expected-parent CAS keeps one winner', () => {
  it('stale parent conflicts and a single retry winner advances', () => {
    assert.ok(validatePushRequest({ ...base, actualParent: 'p1' }).some((e) => e.includes('cas')));
    const outcome = casAdvance([
      { expectedParent: 'p0', actualParent: 'p1' },
      { expectedParent: 'p1', actualParent: 'p1' },
    ]);
    assert.equal(outcome.winner, 1);
    assert.equal(outcome.attempts, 2);
  });

  it('attempts beyond the bound refuse', () => {
    const outcome = casAdvance([
      { expectedParent: 'p0', actualParent: 'p1' },
      { expectedParent: 'p0', actualParent: 'p2' },
      { expectedParent: 'p0', actualParent: 'p3' },
      { expectedParent: 'p0', actualParent: 'p4' },
    ]);
    assert.equal(outcome.winner, -1);
    assert.ok(outcome.attempts <= MAX_CAS_ATTEMPTS + 1);
  });
});

describe('L8-B/J: deploy-key rotation and revocation', () => {
  it('rotation is due after ninety days', () => {
    const now = Date.parse('2026-11-01T00:00:00Z');
    assert.equal(rotationDue({ createdAt: now - 89 * 86400000, now }), false);
    assert.equal(rotationDue({ createdAt: now - 91 * 86400000, now }), true);
    assert.equal(ROTATION_MAX_DAYS, 90);
  });

  it('rotation needs a positive new key and a denied old key', () => {
    assert.deepEqual(verifyRotation({ newKeyPush: 'allowed', oldKeyPush: 'denied' }), []);
    assert.ok(verifyRotation({ newKeyPush: 'denied', oldKeyPush: 'denied' }).length > 0);
    assert.ok(verifyRotation({ newKeyPush: 'allowed', oldKeyPush: 'allowed' }).length > 0);
  });

  it('report ref and path allowlist are frozen', () => {
    assert.equal(REPORT_REF, 'security-reports');
    assert.deepEqual(ALLOWED_PATH_PREFIXES, ['reports/', 'state/', 'index.json']);
  });
});
