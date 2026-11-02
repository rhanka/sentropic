import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

/** Synthetic local authenticator for real-verifier tests; no verifier or identity-store stub. */
export function createSyntheticPasskey(rpId: string, origin: string, userId: string) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new Error('Synthetic P-256 public coordinates missing');
  // Canonical COSE EC2 map: kty=2, alg=-7, crv=1, x/y are public 32-byte coordinates.
  const publicKey = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'),
    Buffer.from(jwk.x, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y, 'base64url')]);
  const credentialId = randomBytes(32).toString('base64url');
  return { credentialId, publicKey,
    registration(challenge: string, userVerified = true, client: { origin?: string; type?: string } = {}): RegistrationResponseJSON {
      const credentialBytes = Buffer.from(credentialId, 'base64url'), prefix = Buffer.alloc(55);
      createHash('sha256').update(rpId).digest().copy(prefix);
      prefix[32] = userVerified ? 0x45 : 0x41; // UP, AT and the actual UV bit; zero counter/AAGUID.
      prefix.writeUInt16BE(credentialBytes.length, 53);
      const authData = Buffer.concat([prefix, credentialBytes, publicKey]);
      // CBOR map {fmt:'none', attStmt:{}, authData:bytes}; this fixture stays below 256 bytes.
      if (authData.length > 255) throw new Error('Synthetic attestation exceeds fixture encoding');
      const attestation = Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a0686175746844617461', 'hex'),
        Buffer.from([0x58, authData.length]), authData]);
      return { id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {},
        response: { attestationObject: attestation.toString('base64url'), transports: ['internal'],
          clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false, ...client })).toString('base64url') } };
    },
    assertion(challenge: string, userVerified: boolean, counter = 1, client: { origin?: string; type?: string } = {}): AuthenticationResponseJSON {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false, ...client }));
      const authenticatorData = Buffer.alloc(37);
      createHash('sha256').update(rpId).digest().copy(authenticatorData);
      authenticatorData[32] = userVerified ? 0x05 : 0x01;
      authenticatorData.writeUInt32BE(counter, 33);
      const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientData).digest()]);
      return { id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: clientData.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'),
          signature: sign('sha256', signed, pair.privateKey).toString('base64url'),
          userHandle: Buffer.from(userId).toString('base64url') } };
    },
  };
}
