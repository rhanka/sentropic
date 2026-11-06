import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ops } from './ops.mjs';
import { digest, privateInput } from './guards.mjs';
import { approvedRequest, commit, image, sha } from './fixtures.mjs';
import { activeRef, approvalRef, compose, entrypoint } from '../../k8s/overlays/preprod/a4-runtime/launch.mjs';

const request = { ...approvedRequest, namespace: 'sentropic-preprod', candidateCommit: commit, candidateImage: image,
  operationId: 'a4', backupTemplateSha256: sha, remoteSnapshotDigest: digest('{}') };
const env = { A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request', A4_DRY_RUN: '1' };
test('should preserve the IdP entrypoint and wire both stopped consumers without scaling', () => {
  assert.deepEqual(entrypoint(['--idp']), ['/workspace/apps/auth-idp/dist/index.js']);
  assert.deepEqual(entrypoint(['--cm-preprod-verify']), ['/workspace/api/dist/index.js', '--cm-preprod-verify']);
  const calls = [], read = path => path === env.A4_REQUEST_FILE ? JSON.stringify(request) : 'private';
  const call = (_config, args) => {
    calls.push(args);
    return args[0] === 'get' ? JSON.stringify({ spec: { replicas: 0 } }) : 'runtime';
  };
  ops({ ...env, A4_OPERATION: 'wire', A4_DRY_RUN: '0' }, call, read);
  for (const name of ['api', 'auth-idp']) {
    assert(calls.some(args => args.slice(0, 3).join(' ') === `patch deployment ${name}`));
    assert(calls.some(args => args.join(' ') === `set image deployment/${name} ${name}=${image}`));
  }
  assert(!calls.some(args => args[0] === 'scale'));
  assert.throws(() => ops({ ...env, A4_OPERATION: 'wire', A4_DRY_RUN: '0' }, (_config, args) => {
    assert.equal(args[0], 'get');
    return JSON.stringify({ spec: { replicas: args[2] === 'auth-idp' ? 1 : 0 } });
  }, read), /consumer_not_quiesced/);
});
test('should refuse malformed keys, unexpected previous slots and incorrect active fingerprints', () => {
  const base = { CM_IDENTITY_EMAIL_CODE_POLICY: 'hmac-sha256', CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF: approvalRef,
    CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF: activeRef, EMAIL_CODE_HMAC_KEY_ACTIVE_REF: activeRef };
  for (const change of [{ EMAIL_CODE_HMAC_KEY_ACTIVE: 'invalid' },
    { EMAIL_CODE_HMAC_KEY_ACTIVE: '11'.repeat(32) }, { EMAIL_CODE_HMAC_KEY_PREVIOUS: '' },
    { CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF: 'unapproved' }]) {
    assert.throws(() => compose({ ...base, ...change }));
  }
});
test('should reject symlink and group-readable local operator inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'a4-operator-'));
  try {
    const file = join(root, 'input'), link = join(root, 'link');
    writeFileSync(file, 'synthetic-private-input', { mode: 0o600 }); symlinkSync(file, link);
    assert.equal(privateInput(file), 'synthetic-private-input');
    assert.throws(() => privateInput(link)); chmodSync(file, 0o640); assert.throws(() => privateInput(file));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('should validate qualified budgets privately and create no Secret during dry-run', () => {
  const budgets = { qualificationReceiptRef: 'track:qualified-replica-budget' };
  for (const name of ['reservation', 'deletion', 'diagnostic', 'read', 'workspace', 'replicaExport', 'replicaValidation', 'replicaSync']) {
    budgets[name] = { deadlineMs: 12345, maxAttempts: 1 };
  }
  const calls = [], read = path => path === env.A4_REQUEST_FILE ? JSON.stringify(request) : path === '/private/budgets' ? JSON.stringify(budgets) : 'private';
  const args = { ...env, A4_OPERATION: 'budgets', A4_BUDGETS_FILE: '/private/budgets' };
  assert.match(ops(args, (...args) => calls.push(args), read), /^budgetsSha256=[a-f0-9]{64}\n$/);
  assert.equal(calls.length, 0);
  ops({ ...args, A4_DRY_RUN: '0' }, (...args) => calls.push(args), read);
  const secret = JSON.parse(calls[0][2]); assert.equal(secret.metadata.name, 'sentropic-identity-budgets');
  assert.equal(secret.metadata.namespace, 'sentropic-preprod');
  budgets.replicaSync.maxAttempts = 0;
  assert.throws(() => ops(args, () => assert.fail('must not call kubectl'), read));
});
test('should stage no protected files during inputs dry-run', () => {
  const read = path => path === env.A4_REQUEST_FILE ? JSON.stringify(request) : path === '/private/remote' ? '{}' : 'private';
  const result = ops({ ...env, A4_OPERATION: 'stage', A4_STAGE: 'inputs', A4_REMOTE_FILE: '/private/remote' },
    () => assert.fail('must not call kubectl'), read);
  assert.match(result, /^requestSha256=[a-f0-9]{64}\nremoteSha256=[a-f0-9]{64}\n$/);
});
