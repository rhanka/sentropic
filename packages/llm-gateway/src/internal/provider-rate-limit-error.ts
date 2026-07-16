/**
 * Internal typed signal thrown by the transport layer when the upstream provider
 * returns HTTP 429. The flow layer catches this to drive retry-with-rotation.
 *
 * This is NOT a `GatewayError` — it is an INTERNAL signal, never surfaced to
 * callers. It is intentionally NOT re-exported from the package index.
 */
export class ProviderRateLimitError extends Error {
  constructor(readonly retryAfterMs: number = 60_000) {
    super('upstream provider returned 429 (rate limited)');
    this.name = 'ProviderRateLimitError';
  }
}
