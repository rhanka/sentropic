import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drive } from './t3-window-driver.mjs';
import { PROBE_PATHS, buildProbes, validateProbes } from './t3-lib.mjs';
import { emailProbe, expectedSigningKid } from './t3-probe-fixture.mjs';

// Endpoint set qualified against the candidate in rehearsal r9 (isolated fixture hosts).
const app = 'https://app.restore-a4.test', idp = 'https://auth.restore-a4.test';
const qualified = { appHealth: `${app}/api/v1/health`, idpConfig: `${idp}/.well-known/openid-configuration`,
  idpJwks: `${idp}/.well-known/jwks.json`, s6Authorize: `${idp}/api/v1/auth/oauth/authorize?response_type=code&client_id=immo-mcp`,
  appMe: `${app}/api/v1/me`, idpMe: `${idp}/api/v1/auth/me`,
  emailApp: `${app}/api/v1/auth/email/verify-request`, emailIdp: `${idp}/api/v1/auth/email/verify-request` };
const probes = endpoints => buildProbes({ endpoints, emailProbe, expectedSigningKid }).probes;

test('should accept the probe URLs qualified on the candidate in rehearsal r9', () => {
  assert.doesNotThrow(() => validateProbes(probes(qualified)));
  assert.deepEqual({ ...PROBE_PATHS }, { 'S-3': '/api/v1/health', 'S-4': '/.well-known/openid-configuration',
    'S-5': '/.well-known/jwks.json', 'S-6': '/api/v1/auth/oauth/authorize', 'S-7': '/api/v1/me', 'S-8': '/api/v1/auth/me',
    'S-9a': '/api/v1/auth/email/verify-request', 'S-9b': '/api/v1/auth/email/verify-request' });
});

// With these URLs W8 could never reach ACCEPTED after COMMIT (404 on the candidate).
test('should refuse the former plan URLs of S-7 and S-9, and any other unqualified path', () => {
  for (const [name, url, id] of [['appMe', `${app}/api/v1/auth/me`, 'S-7'],
    ['emailApp', `${app}/api/v1/auth/email/send-code`, 'S-9a'], ['emailIdp', `${idp}/api/v1/auth/email/send-code`, 'S-9b'],
    ['idpMe', `${idp}/api/v1/me`, 'S-8'], ['appHealth', `${app}/health`, 'S-3'], ['idpJwks', `${idp}/jwks.json`, 'S-5']]) {
    assert.throws(() => validateProbes(probes({ ...qualified, [name]: url })), new RegExp(`probe_path_unqualified: ${id}$`));
  }
});

test('should refuse a product probe aimed at the IdP origin and an IdP probe aimed at the product', () => {
  assert.throws(() => validateProbes(probes({ ...qualified, appMe: `${idp}/api/v1/me` })), /probe_origin_mixed: S-3,S-7,S-9a/);
  assert.throws(() => validateProbes(probes({ ...qualified, emailIdp: `${app}/api/v1/auth/email/verify-request` })),
    /probe_origin_mixed: S-4,S-5,S-6,S-8,S-9b/);
});

test('should refuse an unqualified probe URL before the fence, any Kubernetes call and any state write', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 't3-probe-paths-'));
  await assert.rejects(drive({ stateDir, config: { endpoints: { ...qualified, appMe: `${app}/api/v1/auth/me` }, emailProbe, expectedSigningKid },
    call: () => assert.fail('Kubernetes called'), delivered: () => assert.fail('fence started'), print() {} }),
  /probe_path_unqualified: S-7/);
  assert.deepEqual(readdirSync(stateDir), []);
});
