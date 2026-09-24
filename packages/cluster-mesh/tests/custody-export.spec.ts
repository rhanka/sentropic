import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyCustodySignature } from '../src/index.js';

describe('package-root custody signature verifier', () => {
  it('should accept authentic Ed25519 signatures and reject tampering or malformed inputs', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = new TextEncoder().encode('custody');
    const input = {
      payload,
      publicKeyBase64Url: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      signatureBase64Url: sign(null, payload, privateKey).toString('base64url'),
    };
    expect(verifyCustodySignature(input)).toBe(true);
    expect(verifyCustodySignature({ ...input, payload: new TextEncoder().encode('forged') })).toBe(false);
    expect(verifyCustodySignature({ ...input, signatureBase64Url: 'invalid!' })).toBe(false);
    expect(verifyCustodySignature({ ...input, publicKeyBase64Url: 'invalid!' })).toBe(false);
    const otherKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    expect(verifyCustodySignature({ ...input, publicKeyBase64Url: otherKey })).toBe(false);
  });
});
