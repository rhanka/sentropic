import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const SECRET_PREFIX = 'enc:v1:';
const GCM_AUTH_TAG_LENGTH = 16;

/**
 * At-rest key derivation. This module reads `CREDENTIAL_ENCRYPTION_KEY` and the legacy literal ONLY —
 * deliberately NOT `JWT_SECRET`, which is what decouples encryption-at-rest from token signing.
 *
 * DO NOT re-introduce a `|| env.JWT_SECRET` middle term. It looks safer and is the opposite. Deployed
 * environments do not carry `JWT_SECRET` (it is absent from the secret bundle, so containers never
 * receive it), which means the live seed is the literal below. Step 2 of this remediation PROVISIONS a
 * fresh `JWT_SECRET`. With the chain `CEK || JWT || literal`, that provisioning would flip the at-rest
 * seed from the literal to sha256(new JWT_SECRET) and make every stored `enc:v1:` value undecryptable
 * at once — silently, since GCM fails only on read. With the chain as written, provisioning
 * `JWT_SECRET` is a no-op here, which is precisely the property step 2 depends on.
 *
 * The `||` (not `??`) is load-bearing: a Secret delivered as a present-but-EMPTY key would otherwise
 * become the seed. Empty must fall through.
 *
 * Do not "simplify" by trimming, normalising, or base64-decoding the seed: each changes the sha256 and
 * bricks every stored secret.
 */
const resolveSecretKey = (): Buffer => {
  const seed = env.CREDENTIAL_ENCRYPTION_KEY || 'dev-secret-key-change-in-production-please';
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
