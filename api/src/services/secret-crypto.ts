import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { env } from '../config/env';
import { logger } from '../logger';

const ENVELOPE_NAMESPACE = 'enc:';
const GCM_AUTH_TAG_LENGTH = 16;

/** The key version new ciphertext is written under. Step 1 keeps writing v1 — no stored byte moves. */
const CURRENT_KEY_VERSION = 'v1';

/**
 * At-rest key derivation for version `v1`.
 *
 * Reads `SECRET_ENCRYPTION_KEY` and the legacy literal ONLY — deliberately NOT `JWT_SECRET`, which is
 * what decouples encryption-at-rest from token signing, and NOT `OAUTH_SIGNING_KEK`, which rotates on a
 * 90-day schedule (deriving from a rotating key would make every stored secret unreadable at the first
 * rotation — the very failure this remediation exists to remove).
 *
 * DO NOT re-introduce a `|| env.JWT_SECRET` middle term. It looks safer and is the opposite. Deployed
 * environments do not carry `JWT_SECRET` (absent from the secret bundle, so containers never receive
 * it), which means the live seed is the literal below. A later step PROVISIONS a fresh `JWT_SECRET`;
 * with `... || JWT || literal` that provisioning would flip the seed and make every stored envelope
 * undecryptable at once — silently, since GCM fails only on read.
 *
 * `||` (not `??`) is load-bearing: the secret bundle emits present-but-EMPTY keys, and an empty string
 * must fall through rather than become the seed.
 *
 * Do not "simplify" by trimming, normalising, or base64-decoding the seed: each changes the sha256 and
 * bricks every stored secret.
 */
const resolveV1Key = (): Buffer => {
  const seed = env.SECRET_ENCRYPTION_KEY || 'dev-secret-key-change-in-production-please';
  return createHash('sha256').update(seed).digest();
};

/**
 * The keyring. A version present here is READABLE; a version absent is REJECTED, never guessed.
 *
 * This is what makes a future key rotation possible without data loss: a new version is added as a
 * reader FIRST, and only later becomes the writer. Deploying a reader before a writer is not a
 * convenience — it is the condition of reversibility (see the rollback hazard below).
 */
const KEYRING: Record<string, () => Buffer> = {
  v1: resolveV1Key,
};

/**
 * Legacy PLAINTEXT rows read so far, process-lifetime.
 *
 * Unencrypted legacy values are still a legitimate migration path, so they must pass — but silently
 * passing them makes "no plaintext secrets remain" unprovable, which is the same defect as a `?? []`
 * that hides an empty result. Counting them turns that claim into something measurable.
 */
let legacyPlaintextReads = 0;

/** Observability hook: how many legacy plaintext secrets this process has read. */
export const getLegacyPlaintextReadCount = (): number => legacyPlaintextReads;

/** Test seam — resets the counter between cases. */
export const resetLegacyPlaintextReadCount = (): void => {
  legacyPlaintextReads = 0;
};

export const encryptSecret = (value: string): string => {
  const iv = randomBytes(12);
  const key = KEYRING[CURRENT_KEY_VERSION]();
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_NAMESPACE}${CURRENT_KEY_VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const decryptSecret = (value: string): string => {
  // Legacy plaintext: passes, but is COUNTED and logged. Never silent.
  if (!value.startsWith(ENVELOPE_NAMESPACE)) {
    legacyPlaintextReads += 1;
    logger.warn(
      { legacyPlaintextReads },
      'secret-crypto: read a legacy PLAINTEXT secret (not encrypted at rest)',
    );
    return value;
  }

  const [version, ivRaw, tagRaw, bodyRaw] = value.slice(ENVELOPE_NAMESPACE.length).split(':');

  // An envelope whose version we do not know must FAIL LOUD. Returning it verbatim — the previous
  // behaviour — hands the CIPHERTEXT back to the caller as if it were the secret: an older pod
  // rolled back over newer data would send that garbage to Google or OpenAI as a credential, and any
  // write path re-encrypting it produces irreversible double encryption. This rejection therefore
  // has to exist BEFORE any newer version can ever be written, not alongside it.
  const resolveKey = version ? KEYRING[version] : undefined;
  if (!resolveKey) {
    throw new Error(`Unsupported encrypted secret version: ${version || '<empty>'}`);
  }
  if (!ivRaw || !tagRaw || !bodyRaw) {
    throw new Error('Invalid encrypted secret payload.');
  }

  const decipher = createDecipheriv('aes-256-gcm', resolveKey(), Buffer.from(ivRaw, 'base64url'), {
    authTagLength: GCM_AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bodyRaw, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};

export const decryptSecretOrNull = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return decryptSecret(normalized);
};
