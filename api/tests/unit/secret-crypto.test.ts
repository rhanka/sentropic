import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env';
import {
  decryptSecret,
  encryptSecret,
  getLegacyPlaintextReadCount,
  resetLegacyPlaintextReadCount,
} from '../../src/services/secret-crypto';

const LEGACY_LITERAL = 'dev-secret-key-change-in-production-please';

const securityEnv = env as typeof env & { SECRET_ENCRYPTION_KEY?: string };
const originalSecretEncryptionKey = securityEnv.SECRET_ENCRYPTION_KEY;
const originalJwtSecret = securityEnv.JWT_SECRET;

/** Builds an `enc:v1:` envelope with an explicitly chosen seed, independent of the module. */
const sealWithSeed = (value: string, seed: string): string => {
  const iv = randomBytes(12);
  const key = createHash('sha256').update(seed).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

describe('secret encryption — key separation and versioned keyring', () => {
  beforeEach(() => {
    resetLegacyPlaintextReadCount();
  });

  afterEach(() => {
    securityEnv.SECRET_ENCRYPTION_KEY = originalSecretEncryptionKey;
    securityEnv.JWT_SECRET = originalJwtSecret;
  });

  it('keeps the deployed key byte-identical: no variable set means the legacy literal', () => {
    // Deployed containers receive NEITHER variable, so the live at-rest key is sha256 of the literal
    // spelled out below. Nothing may change that until the key is deliberately rotated. The literal
    // is written out rather than imported ON PURPOSE: editing it in the source must break this test,
    // because that edit would silently make every stored envelope undecryptable.
    const plaintext = randomBytes(24).toString('base64url');
    const sealed = sealWithSeed(plaintext, LEGACY_LITERAL);

    securityEnv.SECRET_ENCRYPTION_KEY = undefined;
    // Set to a random value on purpose: this module must NOT read JWT_SECRET. Re-introducing it into
    // the chain would make the seed this random value and break the decryption below — which is the
    // regression to prevent, since a later step provisions a fresh JWT_SECRET in production.
    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');

    expect(decryptSecret(sealed)).toBe(plaintext);
  });

  it('treats an EMPTY key as absent, not as the key', () => {
    // The delivery mechanism emits present-but-empty keys: `--from-literal=VAR="$VAR"` yields VAR=""
    // when the source env file omits the variable, so the container sees an empty string rather than
    // an absent one. `||` falls through; `??` would make '' the seed and brick every stored secret.
    const plaintext = randomBytes(24).toString('base64url');
    const sealed = sealWithSeed(plaintext, LEGACY_LITERAL);

    securityEnv.SECRET_ENCRYPTION_KEY = '';
    expect(decryptSecret(sealed)).toBe(plaintext);
  });

  it('uses SECRET_ENCRYPTION_KEY once set, and ignores JWT_SECRET rotation entirely', () => {
    // The decoupling itself: the dedicated variable is the only input, so rotating the signing key
    // never reaches the cipher. That is what makes the rotation step non-destructive.
    const key = randomBytes(48).toString('base64url');
    const plaintext = randomBytes(24).toString('base64url');
    const sealed = sealWithSeed(plaintext, key);

    securityEnv.SECRET_ENCRYPTION_KEY = key;
    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');
    expect(decryptSecret(sealed)).toBe(plaintext);

    securityEnv.JWT_SECRET = randomBytes(48).toString('base64url');
    expect(decryptSecret(sealed)).toBe(plaintext);
  });

  it('REJECTS an envelope whose version is unknown instead of returning the ciphertext', () => {
    // The rollback hazard, and the reason this must ship before any newer version can be written.
    // Returning the value verbatim handed the CIPHERTEXT back as if it were the secret: an older pod
    // rolled back over newer rows would send that garbage to Google or OpenAI as a credential, and a
    // write path re-encrypting it produces irreversible double encryption.
    const forwardEnvelope = 'enc:v2:aaaa:bbbb:cccc';

    expect(() => decryptSecret(forwardEnvelope)).toThrow(/Unsupported encrypted secret version: v2/);

    // The precise property that matters: it must never come back AS A VALUE.
    let returned: string | null = null;
    try {
      returned = decryptSecret(forwardEnvelope);
    } catch {
      returned = null;
    }
    expect(returned).toBeNull();
  });

  it('lets legacy PLAINTEXT through — the migration path — but COUNTS it', () => {
    // Rejecting plaintext outright would break every not-yet-migrated row, so it must pass. But
    // passing it silently makes "no plaintext secrets remain" unprovable. The counter is what turns
    // that claim into something measurable rather than assumed.
    expect(getLegacyPlaintextReadCount()).toBe(0);

    expect(decryptSecret('a-legacy-unencrypted-secret')).toBe('a-legacy-unencrypted-secret');
    expect(getLegacyPlaintextReadCount()).toBe(1);

    expect(decryptSecret('another-one')).toBe('another-one');
    expect(getLegacyPlaintextReadCount()).toBe(2);

    // A properly sealed value must NOT be counted as plaintext.
    securityEnv.SECRET_ENCRYPTION_KEY = undefined;
    decryptSecret(sealWithSeed('sealed', LEGACY_LITERAL));
    expect(getLegacyPlaintextReadCount()).toBe(2);
  });

  it('round-trips through the current writer version', () => {
    securityEnv.SECRET_ENCRYPTION_KEY = randomBytes(48).toString('base64url');
    const plaintext = randomBytes(24).toString('base64url');
    const sealed = encryptSecret(plaintext);

    // Step 1 still writes v1: no stored byte format changes, so a rollback stays readable.
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain(plaintext);
    expect(decryptSecret(sealed)).toBe(plaintext);
  });
});
