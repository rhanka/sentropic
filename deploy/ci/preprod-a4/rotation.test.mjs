import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { approvalRef, compose } from '../../k8s/overlays/preprod/a4-runtime/launch.mjs';

const slot = (name, hex, tier = 'preprod') => ({ [`EMAIL_CODE_HMAC_KEY_${name}`]: hex,
  [`EMAIL_CODE_HMAC_KEY_${name}_REF`]: `email-code-hmac:v1:${tier}:${createHmac('sha256', Buffer.from(hex, 'hex'))
    .update('sentropic/email-code-hmac/fingerprint/v1').digest('hex').slice(0, 16)}` });
const old = slot('ACTIVE', '11'.repeat(32)), next = slot('PREVIOUS', '22'.repeat(32));
const base = { CM_A4_NAMESPACE: 'sentropic-preprod', CM_IDENTITY_EMAIL_CODE_POLICY: 'hmac-sha256', CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF: approvalRef };
for (const [phase, ring] of Object.entries({ initial: old, overlap: { ...old, ...next },
  promoted: { ...slot('ACTIVE', '22'.repeat(32)), ...slot('PREVIOUS', '11'.repeat(32)) },
  retired: slot('ACTIVE', '22'.repeat(32)) })) {
  test(`should compose the authorized ${phase} ring privately`, () => {
    const env = compose({ ...base, ...ring, CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF: 'stale-config' });
    assert.equal(env.CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF, ring.EMAIL_CODE_HMAC_KEY_ACTIVE_REF);
    assert.deepEqual(JSON.parse(env.CM_IDENTITY_EMAIL_CODE_PREVIOUS_KEY_REFS_JSON),
      ring.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF ? [ring.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF] : []);
    const keys = JSON.parse(env.CM_IDENTITY_EMAIL_CODE_KEYS_JSON);
    assert.equal(keys[ring.EMAIL_CODE_HMAC_KEY_ACTIVE_REF], Buffer.from(ring.EMAIL_CODE_HMAC_KEY_ACTIVE, 'hex').toString('base64url'));
    assert(!Object.keys(env).some(name => name.startsWith('EMAIL_CODE_HMAC_')));
  });
}
test('should refuse incomplete, duplicate, foreign-tier and mismatched fingerprint slots', () => {
  for (const change of [{ EMAIL_CODE_HMAC_KEY_PREVIOUS: next.EMAIL_CODE_HMAC_KEY_PREVIOUS },
    { EMAIL_CODE_HMAC_KEY_PREVIOUS_REF: next.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF },
    { ...slot('PREVIOUS', '11'.repeat(32)) }, { ...next, EMAIL_CODE_HMAC_KEY_PREVIOUS: '33'.repeat(32) },
    { EMAIL_CODE_HMAC_KEY_ACTIVE_REF: old.EMAIL_CODE_HMAC_KEY_ACTIVE_REF.replace('preprod', 'prod') }]) {
    assert.throws(() => compose({ ...base, ...old, ...change }));
  }
});
test('should bind the key ring tier to the pod namespace and refuse an unknown or foreign namespace', () => {
  const prod = slot('ACTIVE', '33'.repeat(32), 'prod');
  const env = compose({ ...base, CM_A4_NAMESPACE: 'sentropic', ...prod });
  assert.equal(env.CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF, prod.EMAIL_CODE_HMAC_KEY_ACTIVE_REF);
  assert.throws(() => compose({ ...base, CM_A4_NAMESPACE: 'sentropic', ...old }), /hmac_custody_invalid/);
  assert.throws(() => compose({ ...base, CM_A4_NAMESPACE: 'sentropic-preprod', ...prod }), /hmac_custody_invalid/);
  for (const namespace of [undefined, '', 'sentropic-restore-a4', 'toString']) {
    assert.throws(() => compose({ ...base, CM_A4_NAMESPACE: namespace, ...old }), /hmac_custody_invalid/);
  }
});
