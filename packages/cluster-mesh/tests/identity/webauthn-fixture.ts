import { createHash, generateKeyPairSync, sign } from 'node:crypto';

const bytes = (...values: (number | Uint8Array)[]): Buffer => Buffer.concat(values.map((value) => typeof value === 'number' ? Buffer.from([value]) : Buffer.from(value)));
const head = (major: number, size: number): Buffer => size < 24 ? bytes(major * 32 + size) : size < 256 ? bytes(major * 32 + 24, size) : bytes(major * 32 + 25, size >> 8, size & 255);
const cbor = (value: string | number | Uint8Array | Map<unknown, unknown>): Buffer => {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const text = Buffer.from(value); return bytes(head(3, text.length), text); }
  if (value instanceof Uint8Array) return bytes(head(2, value.length), value);
  return bytes(head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key as string), cbor(item as string)]));
};
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest();
const encoded = (value: Uint8Array) => Buffer.from(value).toString('base64url');
export const webauthnFixture = () => {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), jwk = key.publicKey.export({ format: 'jwk' });
  const publicKey = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
  const id = Buffer.from('real-verifier-credential'), credentialId = encoded(id);
  return {
    credentialId, publicKey,
    registration: (challenge: string, rp = 'example.test', origin = 'https://example.test') => {
      const authData = bytes(sha(rp), 0x45, Buffer.alloc(4), Buffer.alloc(16), 0, id.length, id, publicKey);
      const attestation = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: credentialId, rawId: credentialId, type: 'public-key' as const, clientExtensionResults: {},
        response: { attestationObject: encoded(attestation), clientDataJSON: encoded(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }))), transports: ['internal' as const] } };
    },
    assertion: (challenge: string, counter: number, uv = true, rp = 'example.test', origin = 'https://example.test') => {
      const count = Buffer.alloc(4); count.writeUInt32BE(counter);
      const authData = bytes(sha(rp), uv ? 5 : 1, count), client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      return { id: credentialId, rawId: credentialId, type: 'public-key' as const, clientExtensionResults: {},
        response: { authenticatorData: encoded(authData), clientDataJSON: encoded(client), signature: encoded(sign('sha256', bytes(authData, sha(client)), key.privateKey)) } };
    },
  };
};
