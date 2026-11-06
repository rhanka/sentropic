import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { approvalRef, compose } from '../../k8s/overlays/preprod/a4-runtime/launch.mjs';

const slot = (name, hex) => ({ [`EMAIL_CODE_HMAC_KEY_${name}`]: hex,
  [`EMAIL_CODE_HMAC_KEY_${name}_REF`]: `email-code-hmac:v1:preprod:${createHmac('sha256', Buffer.from(hex, 'hex'))
    .update('sentropic/email-code-hmac/fingerprint/v1').digest('hex').slice(0, 16)}` });
const old = slot('ACTIVE', '11'.repeat(32)), next = slot('PREVIOUS', '22'.repeat(32));
const base = { CM_IDENTITY_EMAIL_CODE_POLICY: 'hmac-sha256', CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF: approvalRef };
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
