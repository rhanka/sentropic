/**
 * Provider-SHAPED error bodies (spec §3b). The gateway NEVER leaks pool
 * internals — pool/auth failures surface only as provider-style availability /
 * rate-limit / auth errors. Two shapes: Anthropic and OpenAI.
 *
 * Mapping (spec §3b):
 *   401  caller-auth-fail                -> provider auth-error
 *   401  upstream-auth-failed (BR77)     -> provider auth-error (NOT pooled 503)
 *   429  over-budget (BR-47)             -> provider rate-limit + Retry-After
 *   429  upstream-rate-limited (BR77)    -> provider rate-limit + Retry-After
 *   429  no-eligible-account             -> provider overloaded + Retry-After
 *   503  pooled-account-unavailable      -> provider overloaded (NOT pool detail)
 *   503  budget-unavailable (BR-47)      -> same sanitized body (pricing/store failure)
 *   400  bad-request                     -> provider invalid-request
 *   404  unknown-model (Lot 1)             -> provider not-found (model-only message)
 *   503  no-route (BR-REL-Q7)              -> provider api/server error + x-should-retry:false
 * The gateway maps internal failure CLASSES to these — callers see only the
 * provider-shaped surface, never `no_account` / lease / reservation internals.
 */

import type { GatewayWire } from '../ports/dispatch.js';
import type { ResolvedTarget } from '../flow.js';
import { isRoutePlanError, isRouteQuoteError } from '../internal/mesh-routing-error.js';

export interface NativeValidationPublicDetail {
  readonly type: string;
  readonly message: string;
}

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
  | 'caller-auth-unavailable'
  | 'over-budget'
  | 'no-eligible-account'
  | 'pooled-account-unavailable'
  | 'budget-unavailable'
  | 'upstream-auth-failed'
  | 'upstream-rate-limited'
  | 'bad-request'
  | 'native-required'
  | 'native-max-tokens-required'
  | 'native-unavailable'
  | 'unknown-model'
  | 'no-route'
  | 'cross-user-disabled';

export class GatewayError extends Error {
  constructor(
    readonly kind: GatewayFailureKind,
    /** Internal, redaction-safe detail for logs — NEVER sent to the client. */
    message: string,
    /** Seconds for a `Retry-After` header, when the kind warrants one. */
    readonly retryAfterSeconds?: number,
    /** Present only after a provider/model has been selected for dispatch. */
    readonly servedTarget?: ResolvedTarget,
    /** Public validation detail for native 400 fidelity; excluded from logs/ledgers. */
    readonly validation?: NativeValidationPublicDetail,
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
 * Lot 1 unknown-model 404 message. Built ONLY from the validated requested
 * model (`router/index.ts` `readModel`); never from `error.message`, an
 * error-carried model, or the selected upstream model. The fallback covers
 * direct mapper callers with no request context — HTTP inference routes must
 * always supply their validated model.
 */
const unknownModelMessage = (requestedModel?: string): string =>
  requestedModel ? `Unknown model: ${JSON.stringify(requestedModel)}` : 'Unknown model';

/**
 * BR-REL-Q7 known-model no-route message. Names ONLY the validated requested
 * model — never overloaded/rate-limit wording, so SDKs do not retry-loop.
 */
const noRouteMessage = (requestedModel?: string): string =>
  requestedModel ? `No route available for model: ${JSON.stringify(requestedModel)}` : 'No route available';

const isValidValidationDetail = (
  detail: unknown,
): detail is NativeValidationPublicDetail =>
  Boolean(
    detail
    && typeof detail === 'object'
    && (detail as NativeValidationPublicDetail).type === 'invalid_request_error'
    && typeof (detail as NativeValidationPublicDetail).message === 'string'
    && (detail as NativeValidationPublicDetail).message.length > 0
    && (detail as NativeValidationPublicDetail).message.length <= 4096,
  );

const isNativeMessagesUpstreamError = (
  error: unknown,
): error is {
  status: number;
  type?: string;
  validation?: NativeValidationPublicDetail;
} =>
  Boolean(
    error
    && typeof error === 'object'
    && (error as { name?: unknown }).name === 'NativeMessagesUpstreamError'
    && typeof (error as { status?: unknown }).status === 'number',
  );

/**
 * Map an internal failure class to a provider-shaped error for the wire. The
 * CLIENT-FACING message is a fixed, pool-internal-free string per class; the
 * internal `error.message` (with any account/lease detail) stays in logs only.
 */
export const mapGatewayError = (
  wire: GatewayWire,
  kind: GatewayFailureKind,
  retryAfterSeconds?: number,
  requestedModel?: string,
  validation?: NativeValidationPublicDetail,
): ProviderShapedError => {
  const anthropic = wire === 'anthropic-messages';
  const retry = retryAfterHeader(retryAfterSeconds);
  switch (kind) {
    case 'native-required':
    case 'native-unavailable': {
      const message = anthropic
        ? 'safeguards is not supported by this gateway route; retry without safeguards.'
        : 'safeguards requires the Anthropic Messages endpoint.';
      return anthropic ? anthropicError(400, 'invalid_request_error', message)
        : openAiError(400, 'invalid_request_error', message, 'invalid_request');
    }
    case 'native-max-tokens-required': {
      const message = 'safeguards requires a positive integer max_tokens.';
      return anthropic ? anthropicError(400, 'invalid_request_error', message)
        : openAiError(400, 'invalid_request_error', message, 'invalid_request');
    }
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

    case 'caller-auth-unavailable':
    case 'pooled-account-unavailable':
    case 'budget-unavailable':
      return anthropic
        ? anthropicError(503, 'overloaded_error', 'service temporarily unavailable', retry)
        : openAiError(503, 'rate_limit_error', 'service temporarily unavailable', 'overloaded', retry);

    case 'upstream-auth-failed':
      return anthropic
        ? anthropicError(401, 'authentication_error', 'authentication failed')
        : openAiError(401, 'authentication_error', 'authentication failed', 'invalid_api_key');

    case 'upstream-rate-limited':
      return anthropic
        ? anthropicError(429, 'rate_limit_error', 'rate limit exceeded', retry)
        : openAiError(429, 'rate_limit_error', 'rate limit exceeded', 'rate_limit_exceeded', retry);

    case 'cross-user-disabled':
      // Surfaced as a plain bad-request — never reveal the kill-switch internal.
      return anthropic
        ? anthropicError(400, 'invalid_request_error', 'request not permitted')
        : openAiError(400, 'invalid_request_error', 'request not permitted', 'unsupported');

    case 'bad-request':
      if (isValidValidationDetail(validation)) {
        return anthropic
          ? anthropicError(400, validation.type, validation.message)
          : openAiError(400, validation.type, validation.message, 'invalid_request');
      }
      return anthropic
        ? anthropicError(400, 'invalid_request_error', 'invalid request')
        : openAiError(400, 'invalid_request_error', 'invalid request', 'invalid_request');

    case 'unknown-model':
      // Lot 1 404: no Retry-After, no x-should-retry, JSON content type is set
      // by the router for both wires including stream:true.
      return anthropic
        ? anthropicError(404, 'not_found_error', unknownModelMessage(requestedModel))
        : openAiError(404, 'invalid_request_error', unknownModelMessage(requestedModel), 'model_not_found');

    case 'no-route': {
      // BR-REL-Q7: non-retryable 503 with an explicit no-retry header and no
      // Retry-After. Never overloaded_error/rate_limit_error.
      const headers = { 'x-should-retry': 'false' };
      return anthropic
        ? anthropicError(503, 'api_error', noRouteMessage(requestedModel), headers)
        : openAiError(503, 'server_error', noRouteMessage(requestedModel), 'no_route', headers);
    }
  }
};

/** Map a thrown `GatewayError` (or unknown error) to a provider-shaped error. */
export const toProviderShapedError = (
  wire: GatewayWire,
  error: unknown,
  requestedModel?: string,
): ProviderShapedError => {
  if (error instanceof GatewayError) {
    return mapGatewayError(wire, error.kind, error.retryAfterSeconds, requestedModel, error.validation);
  }
  if (isNativeMessagesUpstreamError(error)) {
    if (
      error.status === 400
      && (error.type === undefined || error.type === 'invalid_request_error')
      && isValidValidationDetail(error.validation)
    ) {
      return wire === 'anthropic-messages'
        ? anthropicError(400, error.validation.type, error.validation.message)
        : openAiError(400, error.validation.type, error.validation.message, 'invalid_request');
    }
    if (error.status === 401 || error.status === 403 || error.type === 'authentication_error') {
      return mapGatewayError(wire, 'upstream-auth-failed');
    }
  }
  const diagnostic = error && typeof error === 'object'
    ? (error as { diagnostic?: {
        code?: string; transportProviderId?: string;
      } }).diagnostic
    : undefined;
  if (diagnostic?.code === 'reenrollment-required' || diagnostic?.code === 'reauth-required') {
    const transport = diagnostic.transportProviderId ?? 'provider';
    const action = diagnostic.code === 'reenrollment-required' ? 're-enroll' : 'reauthenticate';
    const message = `${transport} ${action} required`;
    const headers = { 'X-Sentropic-Route-Action': `${action}-${transport}` };
    return wire === 'anthropic-messages'
      ? anthropicError(503, 'authentication_error', message, headers)
      : openAiError(503, 'authentication_error', message, 'provider_auth_required', headers);
  }
  // Structural mesh failures (M2 precedence: GatewayError kind, enrollment
  // diagnostic, structural plan/quote, generic 503). Unknown-model becomes the
  // Lot 1 404; capability-invalid and bad ceilings become 400 bad-request;
  // quote-mismatch and unclassified errors stay on the generic 503 below.
  if (isRoutePlanError(error, 'unknown-model') || isRouteQuoteError(error, 'unknown-model')) {
    return mapGatewayError(wire, 'unknown-model', undefined, requestedModel);
  }
  if (isRoutePlanError(error, 'native-unavailable') || isRouteQuoteError(error, 'native-unavailable')) {
    return mapGatewayError(wire, 'native-unavailable');
  }
  // BR-REL-Q7: every known-model no-route without an enrollment diagnostic
  // (checked above) becomes the non-retryable 503. The enrollment-action
  // branch stays unchanged.
  if (isRoutePlanError(error, 'no-route') || isRouteQuoteError(error, 'no-route')) {
    return mapGatewayError(wire, 'no-route', undefined, requestedModel);
  }
  if (
    isRoutePlanError(error, 'capabilities-unmet') || isRouteQuoteError(error, 'capabilities-unmet')
    || isRouteQuoteError(error, 'invalid-ceiling')
  ) {
    return mapGatewayError(wire, 'bad-request');
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
