import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

import { DEVELOPMENT_SECRET_SEED, resolveDeploymentSecret } from '../config/deployment-secrets';
import { logger } from '../logger';

const ENVELOPE_NAMESPACE = 'enc:';
const GCM_AUTH_TAG_LENGTH = 16;

/** The key version new ciphertext is written under. Step 1 keeps writing v1 — no stored byte moves. */
const CURRENT_KEY_VERSION = 'v1';

/**
 * At-rest key derivation for version `v1`: sha256 of `SECRET_ENCRYPTION_KEY`.
 *
 * A deployed runtime without a provisioned key REFUSES (config/deployment-secrets.ts): there is no
 * literal fallback. Envelopes an earlier deployed image sealed under the development seed are moved to
 * the provisioned key with `--secret-reencrypt` BEFORE the key is set (docs/secrets.md). Dev and test
 * keep the development seed, so their stored envelopes stay readable.
 *
 * Reads `SECRET_ENCRYPTION_KEY` ONLY — deliberately NOT `JWT_SECRET`, which is what decouples
 * encryption-at-rest from token signing, and NOT `OAUTH_SIGNING_KEK`, which rotates on a 90-day
 * schedule (deriving from a rotating key would make every stored secret unreadable at the first
 * rotation). DO NOT add a `|| env.JWT_SECRET` term: provisioning or rotating `JWT_SECRET` would then
 * flip the at-rest key and make every stored envelope undecryptable at once — silently, since GCM
 * fails only on read.
 *
 * Do not "simplify" by trimming, normalising, or base64-decoding the seed: each changes the sha256 and
 * bricks every stored secret.
 */
/** sha256 of a seed: the `v1` key. Exported for the re-encryption tool, which holds two seeds at once. */
export const deriveV1Key = (seed: string): Buffer => createHash('sha256').update(seed).digest();

const resolveV1Key = (): Buffer =>
  deriveV1Key(resolveDeploymentSecret('SECRET_ENCRYPTION_KEY', DEVELOPMENT_SECRET_SEED));

/** The connector revocation custody key derived from a `v1` key (HKDF; parameters are part of the data format). */
export const deriveConnectorRevocationKey = (v1Key: Buffer): Buffer =>
  Buffer.from(hkdfSync('sha256', v1Key, 'sentropic-secret-custody-v1', 'A2.0b/connector-revocation/v1', 32));

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

/** Protected synchronous borrowing; v1 retains its existing source-key semantics. */
export function withConnectorRevocationKey<T>(keyRef: string, operation: (key: Buffer) => T): T {
  const version = /^secret-crypto:(v\d+)$/.exec(keyRef)?.[1];
  const resolveKey = version ? KEYRING[version] : undefined;
  if (!resolveKey) throw new SecretEnvelopeError('Unsupported custody key version.', {
    reason: 'unsupported_version', version: null,
  });
  const source = resolveKey();
  let dedicated: Buffer | undefined;
  try {
    dedicated = deriveConnectorRevocationKey(source);
    return operation(dedicated);
  } finally { dedicated?.fill(0); source.fill(0); }
}

/**
 * A refusal to read a stored envelope, raised with a RECOGNISABLE type.
 *
 * Failing loud is correct; failing ANONYMOUSLY is not. This throw propagates uncaught to every
 * consumer (Drive, llm-account-transports, provider-connections, provider-credentials), so during a
 * key rotation an inconsistent key would surface as an unattributable 500. A named type lets callers
 * and operators tell "the at-rest key does not match this envelope" apart from any other failure.
 */
export class SecretEnvelopeError extends Error {
  readonly reason: 'unsupported_version' | 'malformed_payload';
  readonly version: string | null;

  constructor(
    message: string,
    options: { reason: 'unsupported_version' | 'malformed_payload'; version: string | null },
  ) {
    super(message);
    this.name = 'SecretEnvelopeError';
    this.reason = options.reason;
    this.version = options.version;
  }
}

/**
 * Legacy PLAINTEXT rows read so far, process-lifetime.
 *
 * Unencrypted legacy values are still a legitimate migration path, so they must pass — but silently
 * passing them makes "no plaintext secrets remain" unprovable, which is the same defect as a `?? []`
 * that hides an empty result. Counting them turns that claim into something measurable.
 */
let legacyPlaintextReads = 0;

/**
 * Log brake. The counter is the measurement; the log is only the alert. Emitting a line on EVERY
 * read would drown the journal on a hot path — and a drowned journal is one people stop reading,
 * which defeats the point of alerting at all. Log the first few, then geometrically.
 */
const shouldLogPlaintextRead = (count: number): boolean =>
  count <= 3 || count === 10 || count === 100 || count % 1000 === 0;

/** Observability hook: how many legacy plaintext secrets this process has read. */
export const getLegacyPlaintextReadCount = (): number => legacyPlaintextReads;

/** Test seam — resets the counter between cases. */
export const resetLegacyPlaintextReadCount = (): void => {
  legacyPlaintextReads = 0;
};

/** Seal `value` as a `v1` envelope under an explicit key (the writer below and the re-encryption tool). */
export const sealSecretWithKey = (value: string, key: Buffer): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_NAMESPACE}${CURRENT_KEY_VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const encryptSecret = (value: string): string => sealSecretWithKey(value, KEYRING[CURRENT_KEY_VERSION]());

const decipherPayload = (key: Buffer, ivRaw: string, tagRaw: string, bodyRaw: string): string => {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'), {
    authTagLength: GCM_AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyRaw, 'base64url')), decipher.final()]).toString('utf8');
};

/** Open a `v1` envelope under an explicit key (re-encryption tool). Throws on another version or a key mismatch. */
export const openSecretWithKey = (value: string, key: Buffer): string => {
  const [version, ivRaw, tagRaw, bodyRaw] = value.startsWith(ENVELOPE_NAMESPACE)
    ? value.slice(ENVELOPE_NAMESPACE.length).split(':') : [];
  if (version !== CURRENT_KEY_VERSION || !ivRaw || !tagRaw || !bodyRaw) {
    throw new SecretEnvelopeError('Not a v1 envelope.', { reason: 'unsupported_version', version: version || null });
  }
  return decipherPayload(key, ivRaw, tagRaw, bodyRaw);
};

export const decryptSecret = (value: string): string => {
  // Legacy plaintext: passes, but is COUNTED and logged. Never silent.
  if (!value.startsWith(ENVELOPE_NAMESPACE)) {
    legacyPlaintextReads += 1;
    if (shouldLogPlaintextRead(legacyPlaintextReads)) {
      logger.warn(
        { legacyPlaintextReads },
        'secret-crypto: read a legacy PLAINTEXT secret (not encrypted at rest)',
      );
    }
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
    throw new SecretEnvelopeError(`Unsupported encrypted secret version: ${version || '<empty>'}`, {
      reason: 'unsupported_version',
      version: version || null,
    });
  }
  if (!ivRaw || !tagRaw || !bodyRaw) {
    throw new SecretEnvelopeError('Invalid encrypted secret payload.', {
      reason: 'malformed_payload',
      version,
    });
  }

  return decipherPayload(resolveKey(), ivRaw, tagRaw, bodyRaw);
};

export const decryptSecretOrNull = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return decryptSecret(normalized);
};
