import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env';
import { decryptSecret } from '../../src/services/secret-crypto';

const securityEnv = env as typeof env & {
  CREDENTIAL_ENCRYPTION_KEY?: string;
};
const originalCredentialEncryptionKey = securityEnv.CREDENTIAL_ENCRYPTION_KEY;
const originalJwtSecret = securityEnv.JWT_SECRET;

const encryptWithLegacyDerivation = (value: string, seed: string): string => {
  const iv = randomBytes(12);
  const key = createHash('sha256').update(seed).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

describe('secret encryption key separation', () => {
  afterEach(() => {
    securityEnv.CREDENTIAL_ENCRYPTION_KEY = originalCredentialEncryptionKey;
    securityEnv.JWT_SECRET = originalJwtSecret;
  });

  it('decrypts a legacy envelope only with the byte-exact credential key', () => {
    const legacySeed = randomBytes(48).toString('base64url');
    const plaintext = randomBytes(24).toString('base64url');
    const legacyEnvelope = encryptWithLegacyDerivation(plaintext, legacySeed);

    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');
    securityEnv.CREDENTIAL_ENCRYPTION_KEY = legacySeed;

    expect(decryptSecret(legacyEnvelope)).toBe(plaintext);

    securityEnv.CREDENTIAL_ENCRYPTION_KEY = `${legacySeed}\n`;
    expect(() => decryptSecret(legacyEnvelope)).toThrow();
  });

  it('still decrypts values written under JWT_SECRET when the new key is UNSET', () => {
    // THE migration invariant. Before the split the seed was `JWT_SECRET || <literal>`, so any
    // environment with JWT_SECRET set has its stored secrets keyed on sha256(JWT_SECRET). If this
    // deployment rolls out before an operator copies that value into CREDENTIAL_ENCRYPTION_KEY, the
    // key must NOT silently change — every enc:v1: value would become undecryptable at once, and GCM
    // only reveals it on read, long after the deploy looked healthy.
    //
    // This must hold BY CONSTRUCTION, not by procedure: the live production environment could not be
    // inspected from here, so we cannot know whether JWT_SECRET is set there.
    const jwtSecret = randomBytes(48).toString('base64url');
    const plaintext = randomBytes(24).toString('base64url');
    const envelopeWrittenBeforeTheSplit = encryptWithLegacyDerivation(plaintext, jwtSecret);

    securityEnv.JWT_SECRET = jwtSecret;
    securityEnv.CREDENTIAL_ENCRYPTION_KEY = undefined;

    expect(decryptSecret(envelopeWrittenBeforeTheSplit)).toBe(plaintext);
  });

  it('lets CREDENTIAL_ENCRYPTION_KEY override JWT_SECRET, so rotating JWT_SECRET is safe', () => {
    // The other half of the decoupling, and the reason step 2 (rotate JWT_SECRET) stops being
    // destructive: once the dedicated variable is set, JWT_SECRET no longer reaches the cipher.
    const credentialKey = randomBytes(48).toString('base64url');
    const plaintext = randomBytes(24).toString('base64url');
    const envelope = encryptWithLegacyDerivation(plaintext, credentialKey);

    securityEnv.CREDENTIAL_ENCRYPTION_KEY = credentialKey;
    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');
    expect(decryptSecret(envelope)).toBe(plaintext);

    // Rotating JWT_SECRET again must not disturb the at-rest key.
    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');
    expect(decryptSecret(envelope)).toBe(plaintext);
  });
});
