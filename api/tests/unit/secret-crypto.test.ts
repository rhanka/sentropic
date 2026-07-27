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
});
