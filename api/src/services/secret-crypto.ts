import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const SECRET_PREFIX = 'enc:v1:';

const resolveSecretKey = (): Buffer => {
  const seed = env.JWT_SECRET || 'dev-secret-key-change-in-production-please';
  return createHash('sha256').update(seed).digest();
};

export const encryptSecret = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveSecretKey(), iv);
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
