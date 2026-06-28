/**
 * Slice 2/7 fix G4 — opaque handle for a caller-controlled idempotency key.
 *
 * The raw `idempotencyKey` is supplied by the caller and may be a token, secret
 * or PII string. Audit events MUST NOT carry it raw (a redactor only catches
 * KNOWN secret values; an arbitrary idempotency key is not registered). Instead
 * audit carries this short, stable, one-way digest: the same key always maps to
 * the same handle (so idempotent launches stay correlatable in audit) while the
 * raw value never reaches a log/audit line.
 *
 * MOCK-ONLY: deterministic SHA-256 over the key; no salt, no secret material.
 */
import { createHash } from 'node:crypto';

/**
 * Stable, opaque audit handle for an idempotency key. `undefined` in →
 * `undefined` out (the field is simply omitted when no key was supplied).
 */
export function idempotencyDigest(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  return `idk_${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}
