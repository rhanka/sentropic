import { Buffer } from 'node:buffer';
import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import type {
  CustodySigningPort,
  CustodyTokenIssuer,
  CustodyTrustRoot,
} from './custody-types.js';

export interface EphemeralCustodyKey {
  readonly issuer: CustodyTokenIssuer;
  readonly signer: CustodySigningPort;
  readonly trustRoot: CustodyTrustRoot;
}

export function createEphemeralCustodyKey(issuerId: string): EphemeralCustodyKey {
  if (!issuerId) throw new TypeError('custody issuerId is required');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const issuer: CustodyTokenIssuer = {
    issuerId,
    keyId: randomUUID(),
    algorithm: 'EdDSA',
    curve: 'Ed25519',
  };
  const publicKeyBase64Url = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  return {
    issuer,
    signer: {
      async signCanonical(payload) {
        return sign(null, payload, privateKey).toString('base64url');
      },
    },
    trustRoot: {
      async resolve(candidate) {
        return candidate.issuerId === issuer.issuerId
          && candidate.keyId === issuer.keyId
          && candidate.algorithm === issuer.algorithm
          && candidate.curve === issuer.curve
          ? { publicKeyBase64Url }
          : null;
      },
    },
  };
}

export function verifyCustodySignature(input: {
  readonly publicKeyBase64Url: string;
  readonly payload: Uint8Array;
  readonly signatureBase64Url: string;
}): boolean {
  try {
    const publicBytes = Buffer.from(input.publicKeyBase64Url, 'base64url');
    const signature = Buffer.from(input.signatureBase64Url, 'base64url');
    if (
      publicBytes.toString('base64url') !== input.publicKeyBase64Url
      || signature.toString('base64url') !== input.signatureBase64Url
    ) return false;
    const publicKey = createPublicKey({ key: publicBytes, format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, input.payload, publicKey, signature);
  } catch {
    return false;
  }
}
