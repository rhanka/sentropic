import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseRemoteJson, remoteDigest, remoteSignedBytes } from '../../../src/services/auth/remote-contract';
import { loadRemoteSigner, validateRemoteTrust } from '../../../src/services/auth/remote-keys';

const roles = ['idp', 'attestation', 'mesh'] as const;
function trust() {
  return Object.fromEntries(roles.map((role) => {
    const pair = generateKeyPairSync('ed25519');
    return [role, { issuer: role, kid: `${role}-1`, workload: role, secretRef: `${role}-secret`,
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }];
  })) as Record<typeof roles[number], { issuer: string; kid: string; workload: string;
    secretRef: string; publicKeyPem: string; privateKeyPem: string }>;
}

describe('RC1 strict wire and key separation', () => {
  it('should use JCS without Unicode or newline normalization', () => {
    expect(remoteSignedBytes({ kind: 'target', z: 'e\u0301\r\n', a: 1 }).toString())
      .toBe('sentropic.remote-action-v1/target\0{"a":1,"kind":"target","z":"é\\r\\n"}');
    expect(remoteDigest('input', Buffer.from('line\n')))
      .not.toBe(remoteDigest('input', Buffer.from('line\r\n')));
    expect(remoteDigest('target', { a: 1 })).not.toBe(remoteDigest('session-attestation', { a: 1 }));
  });
  it.each(['{"a":1,"a":2}', '{"a":{"x":1,"x":2}}', '{"x":"\\ud800"}',
    '{"x":9007199254740992}', '{"x":1} trailing'])('should reject ambiguous JSON %s', (value) => {
    expect(() => parseRemoteJson(Buffer.from(value))).toThrow();
  });
  it('should reject malformed UTF-8 and oversized records before parsing', () => {
    expect(() => parseRemoteJson(Buffer.from([0xc0, 0xaf]))).toThrow();
    expect(() => parseRemoteJson(Buffer.alloc(8193))).toThrow();
  });
  it('should accept three distinct keys/workloads/secrets', () => {
    expect(() => validateRemoteTrust(trust())).not.toThrow();
  });
  it.each(['publicKeyPem', 'workload', 'secretRef', 'kid'] as const)
    ('should refuse reused %s across signing purposes', (field) => {
      const pins = trust();
      pins.attestation[field] = pins.idp[field];
      expect(() => validateRemoteTrust(pins)).toThrow();
    });
  it('should load only its role secret and verify the key against public trust', () => {
    const pins = trust();
    const reads: string[] = [];
    const signer = loadRemoteSigner(pins, 'attestation', 'attestation', (ref) => {
      reads.push(ref);
      return pins.attestation.privateKeyPem;
    });
    expect(reads).toEqual(['attestation-secret']);
    expect(signer.kid).toBe('attestation-1');
    expect(() => loadRemoteSigner(pins, 'idp', 'attestation', () => pins.idp.privateKeyPem)).toThrow();
    expect(() => loadRemoteSigner(pins, 'attestation', 'attestation', () => pins.idp.privateKeyPem)).toThrow();
  });
});
