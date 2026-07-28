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
    // THE deployed-environment invariant, and the one the suite previously could not see. Deployed
    // containers receive NEITHER variable (JWT_SECRET is absent from the secret bundle, and
    // CREDENTIAL_ENCRYPTION_KEY is not plumbed yet), so the live at-rest key is sha256 of the legacy
    // literal below. Nothing may change that until the key is deliberately rotated.
    //
    // Written with the literal SPELLED OUT rather than imported: the point is to pin the exact bytes
    // production is keyed on. Editing the literal in the source must break this test, because that
    // edit would silently make every stored enc:v1: value undecryptable.
    const plaintext = randomBytes(24).toString('base64url');
    const envelopeKeyedOnTheLiteral = encryptWithLegacyDerivation(
      plaintext,
      'dev-secret-key-change-in-production-please'
    );

    securityEnv.CREDENTIAL_ENCRYPTION_KEY = undefined;
    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');

    // JWT_SECRET is set to a random value on purpose: this module must NOT read it. If a
    // `|| env.JWT_SECRET` term were reintroduced into the chain, the seed would become that random
    // value and this decryption would fail — which is exactly the regression to prevent, because
    // step 2 of the remediation provisions a fresh JWT_SECRET in production.
    expect(decryptSecret(envelopeKeyedOnTheLiteral)).toBe(plaintext);
  });

  it('treats an EMPTY CREDENTIAL_ENCRYPTION_KEY as absent, not as the key', () => {
    // The delivery mechanism emits present-but-empty keys: `--from-literal=VAR="$VAR"` produces
    // VAR="" whenever the source env file omits the variable, so the container sees an empty string
    // rather than an absent one. `||` falls through, `??` would not — and with `??` the seed would
    // become '' and brick every stored secret. This pins the choice of operator.
    const plaintext = randomBytes(24).toString('base64url');
    const envelopeKeyedOnTheLiteral = encryptWithLegacyDerivation(
      plaintext,
      'dev-secret-key-change-in-production-please'
    );

    securityEnv.CREDENTIAL_ENCRYPTION_KEY = '';
    expect(decryptSecret(envelopeKeyedOnTheLiteral)).toBe(plaintext);
  });

  it('uses CREDENTIAL_ENCRYPTION_KEY once set, and ignores JWT_SECRET rotation entirely', () => {
    // The decoupling itself, and the reason step 2 (rotate JWT_SECRET) stops being destructive:
    // the dedicated variable is the only input, so JWT_SECRET never reaches the cipher.
    const credentialKey = randomBytes(48).toString('base64url');
    const plaintext = randomBytes(24).toString('base64url');
    const envelope = encryptWithLegacyDerivation(plaintext, credentialKey);

    securityEnv.CREDENTIAL_ENCRYPTION_KEY = credentialKey;
    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');
    expect(decryptSecret(envelope)).toBe(plaintext);

    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');
    expect(decryptSecret(envelope)).toBe(plaintext);
  });
});
