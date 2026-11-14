import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflight } from './t3-preflight-static.mjs';
import { approvedRequest, image } from './fixtures.mjs';
import { digest, canonical } from './guards.mjs';
import { STATE_HASHES } from './t3-rehearsal.mjs';
import { applicabilityFixture } from './t3-applicability.test.mjs';
import { emailProbe, expectedSigningKid, probeEndpoints, observerProbes } from './t3-probe-fixture.mjs';

export function inputs() {
  const ui = `ghcr.io/rhanka/sentropic-ui@sha256:${'c'.repeat(64)}`;
  const authorization = { ...approvedRequest, format: 'preprod-a4-authorization/1' };
  const annex = { ...approvedRequest, format: 'preprod-a4-execution/1', uiImage: ui,
    actions: { fence: [['scale','deployment/api','--replicas=0']],
      restrict: [['annotate','ingress','sentropic','traefik.ingress.kubernetes.io/router.middlewares=sentropic-preprod-a4-verification@kubernetescrd','--overwrite']],
      'delete-custodian': [['delete','pod','sentropic-a4-custodian','--wait=true','--timeout=180s']],
      'start-api': [['scale','deployment/api','--replicas=1']],
      resume: [['patch','cronjob','pgbackup','--type=merge','-p','{"spec":{"suspend":false}}']],
      'open-traffic': [['annotate','ingress','sentropic','traefik.ingress.kubernetes.io/router.middlewares-']] } };
  annex.middlewareSpec = { ipAllowList: { sourceRange: ['192.0.2.1/32'] } };
  annex.middlewareSpecSha256 = digest(canonical(annex.middlewareSpec));
  const budgets = { qualificationReceiptRef: 'track:t3-qualified' };
  for (const name of ['reservation','deletion','diagnostic','read','workspace','replicaExport','replicaValidation','replicaSync']) {
    budgets[name] = { deadlineMs: 10000, maxAttempts: 1 };
  }
  const files = { '/annex': JSON.stringify(annex), '/authorization': JSON.stringify(authorization),
    '/remote': '{}', '/baseline': JSON.stringify(applicabilityFixture()), '/budgets': JSON.stringify(budgets) };
  files['/rehearsal'] = JSON.stringify({ format: 'preprod-a4-rehearsal/2',candidateCommit: approvedRequest.candidateCommit,
    receiptRef: 'track:qualified-rehearsal',applicabilityReviewRef: 'track:prior-review',
    restoredBackupSha256: 'd'.repeat(64),isolatedRestoreRef: 'track:qualified-isolated-restore',
    candidateImage: image,candidateBootPassed: true,functionalAuthPassed: true,d11Passed: true,
    ...Object.fromEntries(STATE_HASHES.map(key => [key,'a'.repeat(64)])) });
  files['/acl'] = '-- synthetic ACL';
  files['/acl-receipt'] = JSON.stringify({ aclCatalogSha256: 'a'.repeat(64),aclSqlSha256: digest(files['/acl']) });
  const policy = { originalRehearsalSha256: digest(files['/rehearsal']),baselineSha256: digest(files['/baseline']),
    reviewRef: 'track:qualified-applicability',allowedChanges: ['sourceContentSha256'] };
  annex.applicabilityReceiptPolicySha256 = digest(canonical(policy)); files['/annex'] = JSON.stringify(annex);
  const config = { tier: 'preprod', namespace: 'sentropic-preprod', candidateImage: image,
    request: approvedRequest, images: { candidate: image, ui }, executionFile: '/annex',
    executionSha256: digest(files['/annex']), authorizationFile: '/authorization', kubeconfigFile: '/kube',
    remoteFile: '/remote', budgetsFile: '/budgets', applicabilityBaselineFile: '/baseline',
    rehearsalFile: '/rehearsal',aclReceiptFile: '/acl-receipt',restoreAclFile: '/acl',applicabilityReceiptPolicy: policy,
    endpoints: probeEndpoints(), emailProbe, expectedSigningKid, initialSecretKeyNames: ['EMAIL_VERIFICATION_PEPPER'],
    restrictedProbes: observerProbes().restrictedProbes,
    externalProbes: [{ id: 'external-app',url: 'https://app.test/',expect: 200 },
      { id: 'external-idp',url: 'https://idp.test/.well-known/openid-configuration',expect: 200 }],
    witness: { url: 'https://app.test/api/v1/auth/me',cookie: 'synthetic-witness',expiresAt: new Date(Date.now()+86400000).toISOString() },
    rotationKeyFiles: { apiJwtSecretFile: '/jwt', secretEncryptionKeyFile: '/enc', idpSessionJwtFile: '/idp' },
    revisions: { api: '1', 'auth-idp': '2', ui: '3' }, preCmDir: '/cms' };
  return { config, files, read: name => files[name] ?? 'synthetic-private-input' };
}
test('offline preflight accepts complete bound inputs without invoking Kubernetes', () => {
  const f = inputs();
  assert.equal(preflight(f.config,f.read).namespace,'sentropic-preprod');
});

test('offline preflight refuses each missing annex action and a changed receipt policy', () => {
  for (const action of ['fence','restrict','delete-custodian','start-api','resume','open-traffic']) {
    const f = inputs(), annex = JSON.parse(f.files['/annex']);
    delete annex.actions[action]; f.files['/annex'] = JSON.stringify(annex);
    f.config.executionSha256 = digest(f.files['/annex']);
    assert.throws(() => preflight(f.config,f.read),/action_not_authorized/);
  }
  const f = inputs(); f.config.applicabilityReceiptPolicy.allowedChanges.push('schemaSha256');
  assert.throws(() => preflight(f.config,f.read),/receipt_policy/);
});

test('restore preflight rejects production URLs in every observer and witness path', () => {
  const f = inputs();
  f.config.tier = 'restore'; f.config.namespace = 'sentropic-restore-a4';
  f.config.request = { ...f.config.request,format: 'prod-a4-request/1',namespace: 'sentropic',
    emailCodeActiveKeyRef: 'email-code-hmac:v1:prod:15c2f8b66073655a' };
  for (const path of ['/authorization','/rehearsal']) {
    const value = JSON.parse(f.files[path]); value.format = value.format.replace('preprod-','prod-');
    if (value.namespace) value.namespace = 'sentropic'; f.files[path] = JSON.stringify(value);
  }
  f.config.applicabilityReceiptPolicy.originalRehearsalSha256 = digest(f.files['/rehearsal']);
  const annex = JSON.parse(f.files['/annex'].replaceAll('sentropic-preprod-a4-verification','sentropic-restore-a4-a4-verification'));
  annex.format = 'prod-a4-execution/1'; annex.namespace = 'sentropic';
  annex.applicabilityReceiptPolicySha256 = digest(canonical(f.config.applicabilityReceiptPolicy));
  f.files['/annex'] = JSON.stringify(annex); f.config.executionSha256 = digest(f.files['/annex']);
  const isolated = value => { const url = new URL(value); url.hostname = 'app.restore-a4.test'; return url.href; };
  for (const key of Object.keys(f.config.endpoints)) f.config.endpoints[key] = isolated(f.config.endpoints[key]);
  f.config.witness.url = isolated(f.config.witness.url);
  for (const p of [...f.config.externalProbes,...f.config.restrictedProbes]) p.url = isolated(p.url);
  assert.doesNotThrow(() => preflight(f.config,f.read));
  for (const target of [f.config.witness,f.config.externalProbes[0],f.config.restrictedProbes[0]]) {
    const before = target.url; target.url = 'https://sentropic.sent-tech.ca/';
    assert.throws(() => preflight(f.config,f.read),/fixture_http_not_isolated/); target.url = before;
  }
});
test('offline preflight refuses annex, baseline, keys, remote and budget drift', () => {
  for (const mutate of [
    f => { f.config.executionSha256 = '0'.repeat(64); },
    f => { f.files['/baseline'] = '{}'; },
    f => { f.config.initialSecretKeyNames.push('JWT_SECRET'); },
    f => { f.files['/remote'] = '{"changed":true}'; },
    f => { f.files['/budgets'] = '{}'; },
    f => { f.config.revisions.api = ''; },
  ]) {
    const f = inputs(); mutate(f); assert.throws(() => preflight(f.config,f.read));
  }
});
