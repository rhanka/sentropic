import { generateKeyPairSync, sign } from 'node:crypto';
import { exportJWK } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  canonicalLeaseEnvelope,
  verifyLeaseEnvelope,
  type LeaseEnvelopeFields,
} from '../../src/services/cowork/lease-envelope';

describe('Cowork server-signed lease envelope', () => {
  const fields: LeaseEnvelopeFields = {
    leaseId: 'lease-1', capability: 'input_action', targetDeviceId: 'device-1', nonce: 'nonce-1',
    expiry: '2030-01-01T00:00:00.000Z',
  };

  it('rejects an absent, forged, or tampered MAC over the exact lease fields', async () => {
    const pair = generateKeyPairSync('ed25519');
    const publicJwk = await exportJWK(pair.publicKey) as { crv: 'Ed25519'; kty: 'OKP'; x: string };
    const mac = sign(null, Buffer.from(canonicalLeaseEnvelope(fields)), pair.privateKey).toString('base64url');

    expect(verifyLeaseEnvelope(fields, { kid: 'oauth-key', mac }, publicJwk)).toBe(true);
    expect(verifyLeaseEnvelope(fields, { kid: 'oauth-key', mac: 'forged' }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope({ ...fields, targetDeviceId: 'other-device' }, { kid: 'oauth-key', mac }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope({ ...fields, nonce: 'other-nonce' }, { kid: 'oauth-key', mac }, publicJwk)).toBe(false);
  });
});
