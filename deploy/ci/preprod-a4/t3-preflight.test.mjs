import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflight } from './t3-preflight-static.mjs';
import { approvedRequest, image } from './fixtures.mjs';
import { digest } from './guards.mjs';
import { applicabilityFixture } from './t3-applicability.test.mjs';
import { emailProbe, expectedSigningKid, probeEndpoints } from './t3-probe-fixture.mjs';

export function inputs() {
  const ui = `ghcr.io/rhanka/sentropic-ui@sha256:${'c'.repeat(64)}`;
  const authorization = { ...approvedRequest, format: 'preprod-a4-authorization/1' };
  const annex = { ...approvedRequest, format: 'preprod-a4-execution/1', uiImage: ui,
    actions: { fence: [['scale','deployment/api','--replicas=0']] } };
  const budgets = { qualificationReceiptRef: 'track:t3-qualified' };
  for (const name of ['reservation','deletion','diagnostic','read','workspace','replicaExport','replicaValidation','replicaSync']) {
    budgets[name] = { deadlineMs: 10000, maxAttempts: 1 };
  }
  const files = { '/annex': JSON.stringify(annex), '/authorization': JSON.stringify(authorization),
    '/remote': '{}', '/baseline': JSON.stringify(applicabilityFixture()), '/budgets': JSON.stringify(budgets) };
  const config = { tier: 'preprod', namespace: 'sentropic-preprod', candidateImage: image,
    request: approvedRequest, images: { candidate: image, ui }, executionFile: '/annex',
    executionSha256: digest(files['/annex']), authorizationFile: '/authorization', kubeconfigFile: '/kube',
    remoteFile: '/remote', budgetsFile: '/budgets', applicabilityBaselineFile: '/baseline',
    endpoints: probeEndpoints(), emailProbe, expectedSigningKid, initialSecretKeyNames: ['EMAIL_VERIFICATION_PEPPER'],
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
