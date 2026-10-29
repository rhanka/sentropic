import { expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyAssurance } from '../verifier.mjs';
const root = generateKeyPairSync('ed25519'), foreign = generateKeyPairSync('ed25519');
const policy = { ...JSON.parse(readFileSync(new URL('../policies/qualification-v1.json', import.meta.url))),
  keys: { key1: root.publicKey.export({ format: 'jwk' }) } };
const claims = { iss: 'https://qualification.memory.test', sub: 'subject-1', aud: 'memory-l5', iat: 1000, nbf: 1000, exp: 1400,
  auth_time: 1000, amr: ['pwd', 'otp'], acr: 'urn:qualification:2fa', tid: 'tenant-1' };
const enrollment = { subject: 'subject-1', principalId: 'human-1', tenantId: 'tenant-1', enrolled: true,
  revoked: false, human: true, enrolled2fa: true, receiptDigest: 'sha256:' + 'a'.repeat(64) };
function jwt(overrides = {}, key = root.privateKey) {
  const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const body = `${b64({ alg: 'EdDSA', kid: 'key1', typ: 'JWT' })}.${b64({ ...claims, ...overrides })}`;
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`;
}
const check = (token, options = {}) => verifyAssurance(token, { policy, now: 1001, tenantId: 'tenant-1',
  principalId: 'human-1', enrollment: () => enrollment, ...options });
it('P07.broker.oidc-assurance: should verify signature, enrolled human and fresh 2FA independently', () => {
  expect(check(jwt())).toMatchObject({ authenticated: true, enrolled_2fa: true, step_up_assurance_verified: true });
  expect(check(jwt(), { now: 1300 })).toBeDefined();
  for (const patch of [{ iss: 'https://other.test' }, { aud: 'wrong' }, { exp: 1001 }, { nbf: 1002 },
    { auth_time: 0 }, { auth_time: 1002 }, { amr: undefined }, { acr: undefined }, { tid: 'other' },
    { amr: ['email'], email: 'human@sent-tech.ca' }, { acr: 'model-asserted' }]) {
    expect(() => check(jwt(patch))).toThrow('gate_failed');
  }
  expect(() => check(jwt({}, foreign.privateKey))).toThrow('gate_failed');
  expect(() => check(jwt(), { now: 1301 })).toThrow('gate_failed');
  for (const patch of [{ enrolled: false }, { revoked: true }, { human: false }, { enrolled2fa: false },
    { subject: 'service-principal' }, { principalId: 'another' }, { enrolled: 'true' }]) {
    expect(() => check(jwt(), { enrollment: () => ({ ...enrollment, ...patch }) })).toThrow('gate_failed');
  }
});
it('should keep production roots and verified claim mappings separate from qualification', () => {
  const production = JSON.parse(readFileSync(new URL('../policies/production-v1.json', import.meta.url)));
  expect(production).toMatchObject({ purpose: 'production', issuer: 'https://auth.sent-tech.ca', mappingStatus: 'unverified' });
  expect(() => check(jwt(), { policy: production })).toThrow('gate_failed');
  expect(() => check(jwt({ iss: production.issuer }), { policy: production })).toThrow('gate_failed');
  expect(() => check('approved:true')).toThrow('gate_failed');
});
