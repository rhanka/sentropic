/**
 * Provider-SHAPED error bodies (spec §3b). The gateway NEVER leaks pool
 * internals — pool/auth failures surface only as provider-style availability /
 * rate-limit / auth errors. Two shapes: Anthropic and OpenAI.
 *
 * Mapping (spec §3b):
 *   401  caller-auth-fail                -> provider auth-error
 *   429  over-budget (BR-47)             -> provider rate-limit + Retry-After
 *   429  no-eligible-account             -> provider overloaded + Retry-After
 *   503  pooled-account-unavailable      -> provider overloaded (NOT pool detail)
 *   400  bad-request / unsupported-model -> provider invalid-request
 * The gateway maps internal failure CLASSES to these — callers see only the
 * provider-shaped surface, never `no_account` / lease / reservation internals.
 */

import type { GatewayWire } from '../ports/dispatch.js';

export interface ProviderShapedError {
  readonly status: number;
  readonly body: unknown;
  /** Optional headers (e.g. `Retry-After`) to attach to the response. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Internal failure classes the flow raises. Mapped to provider-shaped errors
 * per wire by `mapGatewayError`. These names NEVER reach the client body.
 */
export type GatewayFailureKind =
  | 'caller-auth-failed'
  | 'over-budget'
  | 'no-eligible-account'
  | 'pooled-account-unavailable'
  | 'bad-request'
  | 'cross-user-disabled';

export class GatewayError extends Error {
  constructor(
    readonly kind: GatewayFailureKind,
    /** Internal, redaction-safe detail for logs — NEVER sent to the client. */
    message: string,
    /** Seconds for a `Retry-After` header, when the kind warrants one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export const anthropicError = (
  status: number,
  type: string,
  message: string,
  headers?: Readonly<Record<string, string>>,
): ProviderShapedError => ({
  status,
  body: { type: 'error', error: { type, message } },
  ...(headers ? { headers } : {}),
});

export const openAiError = (
  status: number,
  type: string,
  message: string,
  code?: string,
  headers?: Readonly<Record<string, string>>,
): ProviderShapedError => ({
  status,
  body: { error: { message, type, ...(code ? { code } : {}) } },
  ...(headers ? { headers } : {}),
});

const retryAfterHeader = (
  seconds: number | undefined,
): Readonly<Record<string, string>> | undefined =>
  typeof seconds === 'number' && seconds > 0
    ? { 'Retry-After': String(Math.ceil(seconds)) }
    : undefined;

/**
 * Map an internal failure class to a provider-shaped error for the wire. The
 * CLIENT-FACING message is a fixed, pool-internal-free string per class; the
 * internal `error.message` (with any account/lease detail) stays in logs only.
 */
export const mapGatewayError = (
  wire: GatewayWire,
  kind: GatewayFailureKind,
  retryAfterSeconds?: number,
): ProviderShapedError => {
  const anthropic = wire === 'anthropic-messages';
  const retry = retryAfterHeader(retryAfterSeconds);

  switch (kind) {
    case 'caller-auth-failed':
      return anthropic
        ? anthropicError(401, 'authentication_error', 'authentication failed')
        : openAiError(401, 'invalid_request_error', 'authentication failed', 'invalid_api_key');

    case 'over-budget':
      return anthropic
        ? anthropicError(429, 'rate_limit_error', 'rate limit exceeded', retry)
        : openAiError(429, 'rate_limit_error', 'rate limit exceeded', 'rate_limit_exceeded', retry);

    case 'no-eligible-account':
      return anthropic
        ? anthropicError(429, 'overloaded_error', 'service temporarily unavailable', retry)
        : openAiError(429, 'rate_limit_error', 'service temporarily unavailable', 'overloaded', retry);

    case 'pooled-account-unavailable':
      return anthropic
        ? anthropicError(503, 'overloaded_error', 'service temporarily unavailable', retry)
        : openAiError(503, 'rate_limit_error', 'service temporarily unavailable', 'overloaded', retry);

    case 'cross-user-disabled':
      // Surfaced as a plain bad-request — never reveal the kill-switch internal.
      return anthropic
        ? anthropicError(400, 'invalid_request_error', 'request not permitted')
        : openAiError(400, 'invalid_request_error', 'request not permitted', 'unsupported');

    case 'bad-request':
      return anthropic
        ? anthropicError(400, 'invalid_request_error', 'invalid request')
        : openAiError(400, 'invalid_request_error', 'invalid request', 'invalid_request');
  }
};

/** Map a thrown `GatewayError` (or unknown error) to a provider-shaped error. */
export const toProviderShapedError = (
  wire: GatewayWire,
  error: unknown,
): ProviderShapedError => {
  if (error instanceof GatewayError) {
    return mapGatewayError(wire, error.kind, error.retryAfterSeconds);
  }
  // Unknown internal failure — never leak the message; map to a generic
  // provider availability error (NOT the internal detail).
  return wire === 'anthropic-messages'
    ? anthropicError(503, 'overloaded_error', 'service temporarily unavailable')
    : openAiError(503, 'rate_limit_error', 'service temporarily unavailable', 'overloaded');
};

/** Map a gateway condition to a provider-shaped error for the given wire (spec §3b). */
export const notImplemented = (wire: GatewayWire): ProviderShapedError =>
  wire === 'anthropic-messages'
    ? anthropicError(501, 'api_error', 'gateway path not implemented in v0 scaffold')
    : openAiError(501, 'server_error', 'gateway path not implemented in v0 scaffold', 'not_implemented');
