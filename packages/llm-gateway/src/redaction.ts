/**
 * Redaction (spec §3/§4/§8). Pooled account ids, access/refresh tokens and
 * refresh-state are HIGH-VALUE secrets. Hooks, logs and traces receive REDACTED
 * descriptors ONLY — never the executable `SecretAuthMaterial`. This module is
 * the single chokepoint that turns a selection into a log-safe shape.
 *
 * Rule: the response body and any log line emitted by the gateway MUST NOT
 * contain the pooled `accessToken` / `refreshToken` / raw `accountId`. The
 * descriptor exposes only a stable, non-reversible fingerprint + coarse
 * metadata (provider, has-refresh, expiry presence).
 */

import type { AuthDescriptor, SecretAuthMaterial } from '@sentropic/llm-mesh';

/** Secret-bearing keys that must NEVER be logged. */
const SECRET_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'idToken',
  'token',
  'authorization',
  'Authorization',
  'x-api-key',
  'apiKey',
]);

/** A short, non-reversible fingerprint of a token for correlation in logs. */
export const fingerprint = (secret: string | undefined | null): string => {
  if (!secret) {
    return 'none';
  }
  // Length + a tiny rolling hash. NOT cryptographic — just enough to tell two
  // tokens apart in a log without revealing any byte of the secret.
  let h = 0;
  for (let i = 0; i < secret.length; i += 1) {
    h = (h * 31 + secret.charCodeAt(i)) >>> 0;
  }
  return `fp_${secret.length}_${h.toString(36)}`;
};

/**
 * A log-safe view of a selected pooled account. Carries ONLY the descriptor
 * (already redacted by llm-mesh) plus a token fingerprint — never the token.
 */
export interface RedactedSelectionView {
  readonly provider: string;
  readonly accountFingerprint: string;
  readonly hasRefreshToken: boolean;
  readonly expiresAtPresent: boolean;
  readonly leaseId?: string;
}

/**
 * Build a log-safe view from the redacted descriptor + executable material.
 * The raw `accountId` is hashed to a fingerprint so logs never carry the pool's
 * internal account identifier verbatim.
 */
export const redactSelection = (
  descriptor: AuthDescriptor,
  material: SecretAuthMaterial,
): RedactedSelectionView => {
  const accessToken = 'accessToken' in material ? material.accessToken : undefined;
  return {
    provider: descriptor.accountProviderId ?? descriptor.sourceType,
    accountFingerprint: fingerprint(descriptor.accountId ?? accessToken),
    hasRefreshToken: Boolean(descriptor.hasRefreshToken),
    expiresAtPresent: Boolean(descriptor.expiresAt),
    ...(typeof descriptor.metadata?.leaseId === 'string'
      ? { leaseId: descriptor.metadata.leaseId }
      : {}),
  };
};

/**
 * Deep-redact an arbitrary value for logging: replaces any secret-bearing key
 * value with a fingerprint. Used to scrub objects before they reach a logger.
 */
export const redactForLog = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key) && typeof val === 'string') {
      out[key] = fingerprint(val);
    } else {
      out[key] = redactForLog(val, depth + 1);
    }
  }
  return out;
};
