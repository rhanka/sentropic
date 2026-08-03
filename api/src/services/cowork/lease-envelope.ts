import { createPublicKey, sign, verify } from 'node:crypto';

import type { JwksPublicJwk } from '@sentropic/auth-hono';
import { createJwksAdapter } from '../auth/jwks-adapter';

export type LeaseEnvelopeFields = {
  leaseId: string;
  capability: string;
  targetDeviceId: string;
  nonce: string;
  expiry: string;
};

export type ServerSignedLeaseEnvelope = { kid: string; mac: string };

/** Canonical, complete and exclusive C4 MAC preimage. */
export function canonicalLeaseEnvelope(fields: LeaseEnvelopeFields): string {
  return JSON.stringify({
    leaseId: fields.leaseId,
    capability: fields.capability,
    targetDeviceId: fields.targetDeviceId,
    nonce: fields.nonce,
    expiry: fields.expiry,
  });
}

/**
 * C4 uses the existing local JWKS signing-key port.  `mac` is an Ed25519
 * signature encoded as base64url so the device can verify it with the pinned
 * JWKS public key; no new Cowork key or shared device secret is introduced.
 */
export async function signLeaseEnvelope(fields: LeaseEnvelopeFields): Promise<ServerSignedLeaseEnvelope> {
  const active = await createJwksAdapter().getActiveKey();
  if (!active?.privateKey) throw new Error('Cowork lease issuance requires an active OAUTH_SIGNING_KEK-class signing key.');
  return {
    kid: active.kid,
    mac: sign(null, Buffer.from(canonicalLeaseEnvelope(fields), 'utf8'), active.privateKey).toString('base64url'),
  };
}

export function verifyLeaseEnvelope(
  fields: LeaseEnvelopeFields,
  envelope: ServerSignedLeaseEnvelope,
  publicJwk: JwksPublicJwk,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalLeaseEnvelope(fields), 'utf8'),
      createPublicKey({ key: publicJwk, format: 'jwk' }),
      Buffer.from(envelope.mac, 'base64url'),
    );
  } catch {
    return false;
  }
}
