import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { GitAppError } from './contracts.js';
import type { EnrollmentRecord, GitAppCustodian, GitAppEnvelopeStore } from './records.js';

/** Host-owned ciphertext storage; no plaintext fallback or environment-key export. */
export const createEncryptedGitAppCustodian = (input: {
  store: GitAppEnvelopeStore; key: Uint8Array;
}): GitAppCustodian => {
  if (input.key.byteLength !== 32) throw new GitAppError('invalid_request');
  const key = Buffer.from(hkdfSync('sha256', input.key, 'cluster-mesh', 'github-app-custody-v1', 32));
  const aad = (ref: string) => Buffer.from(JSON.stringify(['github-app-custody', 1, ref]));
  const seal = (ref: string, record: EnrollmentRecord): string => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(ref));
    const plaintext = Buffer.from(JSON.stringify(record));
    try {
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return JSON.stringify({ v: 1, nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') });
    } finally { plaintext.fill(0); }
  };
  const open = (ref: string, sealed: string): EnrollmentRecord => {
    try {
      const envelope = JSON.parse(sealed);
      if (envelope.v !== 1) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'));
      decipher.setAAD(aad(ref));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
      try {
        const record = JSON.parse(plaintext.toString('utf8')) as EnrollmentRecord;
        if (record.installationRef !== ref) throw new Error();
        return record;
      } finally { plaintext.fill(0); }
    } catch { throw new GitAppError('capability_unavailable'); }
  };
  return {
    create: async (record) => {
      await input.store.transaction(record.installationRef, async (existing) => {
        if (existing !== null) throw new GitAppError('invalid_request');
        return { sealed: seal(record.installationRef, record), result: undefined };
      });
    },
    withRecord: async <T>(ref: string, action: (record: EnrollmentRecord) => Promise<T>): Promise<T> => {
      const outcome = await input.store.transaction(ref, async (sealed) => {
        if (!sealed) throw new GitAppError('capability_unavailable');
        const record = open(ref, sealed);
        // Persist consumed callback states and revocation fences even when the
        // provider fails. The host commits this outcome atomically across replicas.
        let result: { ok: true; value: T } | { ok: false; error: GitAppError };
        try { result = { ok: true, value: await action(record) }; }
        catch (error) { result = { ok: false, error: error instanceof GitAppError ? error : new GitAppError('capability_unavailable') }; }
        return { sealed: seal(ref, record), result };
      });
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    },
  };
};
