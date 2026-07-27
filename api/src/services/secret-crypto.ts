import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const SECRET_PREFIX = 'enc:v1:';
const GCM_AUTH_TAG_LENGTH = 16;

/**
 * At-rest key derivation. `CREDENTIAL_ENCRYPTION_KEY` is the key's OWN variable; `JWT_SECRET` is kept
 * as an intermediate fallback ONLY so that this decoupling is byte-identical in EVERY environment, not
 * merely in the ones we were able to measure.
 *
 * Why the middle term is load-bearing: before this change the seed was `JWT_SECRET || <literal>`. In any
 * environment where `JWT_SECRET` IS set, dropping straight to the literal would re-key the cipher and
 * make every stored `enc:v1:` value undecryptable at once — silently, since GCM failure surfaces only on
 * read. We could not verify the live production environment (its cluster is not reachable from here), so
 * "the operator will carry the old value across" is an assumption, not a guarantee. This chain removes
 * the need for the assumption.
 *
 * It still achieves the decoupling: once `CREDENTIAL_ENCRYPTION_KEY` is set, `JWT_SECRET` no longer
 * influences the at-rest key, which is exactly what makes rotating `JWT_SECRET` (step 2) safe.
 *
 * Do not "simplify" this by trimming, normalising, or base64-decoding the seed: each of those changes the
 * sha256 and bricks every stored secret.
 */
const resolveSecretKey = (): Buffer => {
  const seed =
    env.CREDENTIAL_ENCRYPTION_KEY || env.JWT_SECRET || 'dev-secret-key-change-in-production-please';
  return createHash('sha256').update(seed).digest();
};

export const encryptSecret = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveSecretKey(), iv, {
    authTagLength: GCM_AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const decryptSecret = (value: string): string => {
  if (!value.startsWith(SECRET_PREFIX)) return value;
  const payload = value.slice(SECRET_PREFIX.length);
  const [ivRaw, tagRaw, bodyRaw] = payload.split(':');
  if (!ivRaw || !tagRaw || !bodyRaw) {
    throw new Error('Invalid encrypted secret payload.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    resolveSecretKey(),
    Buffer.from(ivRaw, 'base64url'),
    { authTagLength: GCM_AUTH_TAG_LENGTH },
  );
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
