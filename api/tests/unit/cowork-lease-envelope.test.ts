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
    expect(verifyLeaseEnvelope(fields, { kid: 'oauth-key', mac: '' }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope(fields, { kid: 'oauth-key', mac: 'forged' }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope({ ...fields, leaseId: 'other-lease' }, { kid: 'oauth-key', mac }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope({ ...fields, capability: 'screen_capture' }, { kid: 'oauth-key', mac }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope({ ...fields, targetDeviceId: 'other-device' }, { kid: 'oauth-key', mac }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope({ ...fields, nonce: 'other-nonce' }, { kid: 'oauth-key', mac }, publicJwk)).toBe(false);
    expect(verifyLeaseEnvelope({ ...fields, expiry: '2030-01-02T00:00:00.000Z' }, { kid: 'oauth-key', mac }, publicJwk)).toBe(false);
  });

  it('projects delivery scope to closed allowlist only, dropping invocation, result, metadata, or extra fields', async () => {
    const { projectDeliveryScope } = await import('../../src/services/cowork/device-lease-service');
    const scopeWithExtras = {
      capability: 'input_action' as const,
      serverEnvelope: { kid: 'k1', mac: 'm1' },
      action: { action: 'type', text: 'hello' },
      invocation: { principalId: 'u1', workspaceId: 'w1', sessionId: 's1', targetDeviceId: 'd1', capability: 'input_action', actionHash: 'h1' },
      metadata: { secret: 'do-not-leak' },
      result: { ok: true },
      cancellationRequestedAt: '2026-09-12T00:00:00.000Z',
    };
    const projected = projectDeliveryScope(scopeWithExtras);
    expect(projected).toEqual({
      capability: 'input_action',
      serverEnvelope: { kid: 'k1', mac: 'm1' },
      action: { action: 'type', text: 'hello' },
    });
    expect(projected).not.toHaveProperty('invocation');
    expect(projected).not.toHaveProperty('metadata');
    expect(projected).not.toHaveProperty('result');
    expect(projected).not.toHaveProperty('cancellationRequestedAt');
  });
});
