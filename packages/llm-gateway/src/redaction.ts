/**
 * Redaction (spec §3/§4/§8). Pooled account ids, access/refresh tokens and
 * refresh-state are HIGH-VALUE secrets. Hooks, logs and traces receive REDACTED
 * descriptors ONLY — never the executable `SecretAuthMaterial`. This module is
 * the single chokepoint that turns a selection into a log-safe shape.
 *
 * Rule (spec §3): the response body, the metering record, and any log line the
 * gateway emits MUST NOT contain the pooled `accessToken` / `refreshToken` / raw
 * `accountId`, NOR any pool-INTERNAL id (the `leaseId`, reservation id, stable
 * session id). The log-safe view exposes only coarse, non-identifying metadata
 * (provider, has-refresh, expiry presence) plus a gateway-local OPAQUE
 * correlation id that is minted by the gateway and cannot be reversed back to a
 * pool lease or account.
 */

import type { AuthDescriptor, SecretAuthMaterial } from '@sentropic/llm-mesh';

/** Secret-bearing keys whose value must NEVER be logged (replaced, not hashed). */
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

/** Fixed mask for a redacted secret. Non-reversible, leaks no length. */
export const REDACTED = '[redacted]';

/**
 * Mint a gateway-local OPAQUE correlation id for a selected account. It is a
 * fresh random token — NOT derived from the pool `accountId`/`leaseId` — so it
 * cannot be reversed back to a pool lease or account, yet still lets two log
 * lines for the same call be correlated. (Replaces the prior reversible
 * `fingerprint`, which was a dictionary-reversible unkeyed rolling hash.)
 */
export const newCorrelationId = (): string =>
  `gw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

/**
 * A log-safe view of a selected pooled account. Carries ONLY coarse metadata +
 * a gateway-local opaque correlation id — NEVER the token, the raw account id,
 * or any pool-internal id (`leaseId` / reservation / stable session).
 */
export interface RedactedSelectionView {
  readonly provider: string;
  /** Gateway-minted opaque id — not derived from any pool id (spec §3). */
  readonly correlationId: string;
  readonly hasRefreshToken: boolean;
  readonly expiresAtPresent: boolean;
}

/**
 * Build a log-safe view from the redacted descriptor + executable material.
 * Neither the raw `accountId` nor the `leaseId` is carried: the view exposes a
 * gateway-minted opaque correlation id instead, so the metering/log surface
 * cannot identify the pool lease or account (spec §3).
 */
export const redactSelection = (
  descriptor: AuthDescriptor,
  _material: SecretAuthMaterial,
  correlationId: string = newCorrelationId(),
): RedactedSelectionView => ({
  provider: descriptor.accountProviderId ?? descriptor.sourceType,
  correlationId,
  hasRefreshToken: Boolean(descriptor.hasRefreshToken),
  expiresAtPresent: Boolean(descriptor.expiresAt),
});

/**
 * Deep-redact an arbitrary value for logging: replaces any secret-bearing key
 * value with the fixed `[redacted]` mask (non-reversible, length-hiding). Used
 * to scrub objects before they reach a logger.
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
      out[key] = REDACTED;
    } else {
      out[key] = redactForLog(val, depth + 1);
    }
  }
  return out;
};
