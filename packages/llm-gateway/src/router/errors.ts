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
 *   503  caller-auth-unavailable         -> provider overloaded, auth-subsystem message
 *   503  pooled-account-unavailable      -> provider overloaded, account-subsystem message (NOT pool detail)
 *   503  budget-unavailable (BR-47)      -> provider overloaded, budget-subsystem message (NOT pricing/store detail)
 *   400  bad-request                     -> provider invalid-request
 *   404  unknown-model (Lot 1)             -> provider not-found (model-only message)
 *   503  no-route (BR-REL-Q7)              -> provider api/server error + x-should-retry:false
 * The gateway maps internal failure CLASSES to these — callers see only the
 * provider-shaped surface, never `no_account` / lease / reservation internals.
 */

import type { GatewayWire } from '../ports/dispatch.js';
import type { ResolvedTarget } from '../flow.js';
import { isRoutePlanError, isRouteQuoteError } from '../internal/mesh-routing-error.js';

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
    /**
     * Client-safe bad-request code (spec §16.7: `bad_request` or
     * `unsupported_parameter`). Rendered only for `bad-request` on
     * OpenAI-shaped wires; every other kind stays frozen.
     */
    readonly code?: string,
    /**
     * Client-safe field path (gateway-built, never caller text). Rendered
     * only for `bad-request` on OpenAI-shaped wires.
     */
    readonly param?: string,
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
  /** Validated client-safe field path (spec §16.7); rendered only when safe. */
  param?: string,
): ProviderShapedError => ({
  status,
  body: { error: { message, type, ...(code ? { code } : {}), ...(param ? { param } : {}) } },
  ...(headers ? { headers } : {}),
});

/** Client-safe bad-request codes (spec §16.7); anything else falls back frozen. */
const FIELD_ERROR_CODES: ReadonlySet<string> = new Set(
  ['bad_request', 'unsupported_parameter', 'invalid_request'],
);

/** Field paths are gateway-built from literal segments — never caller text. */
const FIELD_PATH_PATTERN = /^[A-Za-z0-9_.[\]-]+$/;

export interface FieldError {
  readonly code?: string;
  readonly param?: string;
}

const sanitizedFieldError = (field?: FieldError): { code: string; param?: string } => {
  const code = field?.code && FIELD_ERROR_CODES.has(field.code) ? field.code : 'invalid_request';
  const param = field?.param && FIELD_PATH_PATTERN.test(field.param) ? field.param : undefined;
  return param ? { code, param } : { code };
};

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
 * BR-REL-Q7 known-model no-route message. Names the validated requested
 * model — never overloaded/rate-limit wording, so SDKs do not retry-loop.
 * Lot 7: an optional per-transport detail (mesh-authored availability
 * messages, trusted as operator diagnostics and forwarded verbatim) is
 * appended so the body says WHY, while the status/type/header stay frozen.
 */
const noRouteMessage = (requestedModel?: string, detail?: string): string => {
  const base = requestedModel
    ? `No route available for model: ${JSON.stringify(requestedModel)}`
    : 'No route available';
  return detail ? `${base} — ${detail}` : base;
};

/**
 * Map an internal failure class to a provider-shaped error for the wire. The
 * CLIENT-FACING message is a fixed, pool-internal-free string per class,
 * except for the diagnostic trust boundary: `no-route` appends
 * mesh-authored availability detail, and the enrollment-action branch
 * prefers the mesh-authored message over the rebuilt template. The
 * internal `error.message` (with any account/lease detail) stays in logs only.
 */
export const mapGatewayError = (
  wire: GatewayWire,
  kind: GatewayFailureKind,
  retryAfterSeconds?: number,
  requestedModel?: string,
  /** Lot 7: per-transport availability detail, `no-route` only. */
  detail?: string,
  /** Spec §16.7: validated field code/path, `bad-request` only. */
  field?: FieldError,
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

    // Lot 7: each 503 names its failing subsystem so operators can tell
    // caller-auth / account-dispatch / budget failures apart. Status, error
    // type/code, and headers stay frozen; no account, lease, credential, or
    // pricing/store detail ever rides out in these bodies.
    case 'caller-auth-unavailable':
      return anthropic
        ? anthropicError(503, 'overloaded_error', 'authentication service temporarily unavailable', retry)
        : openAiError(503, 'rate_limit_error', 'authentication service temporarily unavailable', 'overloaded', retry);

    case 'pooled-account-unavailable':
      return anthropic
        ? anthropicError(503, 'overloaded_error', 'account service temporarily unavailable', retry)
        : openAiError(503, 'rate_limit_error', 'account service temporarily unavailable', 'overloaded', retry);

    case 'budget-unavailable':
      return anthropic
        ? anthropicError(503, 'overloaded_error', 'budget service temporarily unavailable', retry)
        : openAiError(503, 'rate_limit_error', 'budget service temporarily unavailable', 'overloaded', retry);

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

    case 'bad-request': {
      // Spec §16.7: validated field code/path ride the OpenAI envelope;
      // the Anthropic shape and the no-field frozen shape stay exact.
      if (anthropic || !field) {
        return anthropic
          ? anthropicError(400, 'invalid_request_error', 'invalid request')
          : openAiError(400, 'invalid_request_error', 'invalid request', 'invalid_request');
      }
      const { code, param } = sanitizedFieldError(field);
      return openAiError(400, 'invalid_request_error', 'invalid request', code, undefined, param);
    }

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
        ? anthropicError(503, 'api_error', noRouteMessage(requestedModel, detail), headers)
        : openAiError(503, 'server_error', noRouteMessage(requestedModel, detail), 'no_route', headers);
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
    // Spec §16.7: a GatewayError may carry a validated field code/path;
    // the mapper renders them only for `bad-request` on OpenAI wires.
    const field = error.code !== undefined || error.param !== undefined
      ? { code: error.code, param: error.param }
      : undefined;
    return mapGatewayError(wire, error.kind, error.retryAfterSeconds, requestedModel, undefined, field);
  }
  const record = error && typeof error === 'object'
    ? (error as { diagnostic?: {
        code?: string; transportProviderId?: string; message?: unknown;
      };
      diagnostics?: readonly {
        code?: string; transportProviderId?: string; message?: unknown;
      }[]; })
    : undefined;
  const diagnostic = record?.diagnostic;
  if (diagnostic?.code === 'reenrollment-required' || diagnostic?.code === 'reauth-required') {
    const transport = diagnostic.transportProviderId ?? 'provider';
    const action = diagnostic.code === 'reenrollment-required' ? 're-enroll' : 'reauthenticate';
    // Lot 7: the mesh-authored message (cause, timestamp, repair action)
    // wins; the rebuilt template stays as fallback for messageless errors.
    const message = typeof diagnostic.message === 'string' && diagnostic.message
      ? diagnostic.message
      : `${transport} ${action} required`;
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
  // BR-REL-Q7: every known-model no-route without an enrollment diagnostic
  // (checked above) becomes the non-retryable 503. Lot 7: the per-transport
  // availability entries ride in the body so the 503 says WHY. The
  // enrollment-action branch stays unchanged.
  if (isRoutePlanError(error, 'no-route') || isRouteQuoteError(error, 'no-route')) {
    const entries = record?.diagnostics
      ?? (diagnostic && typeof diagnostic.message === 'string' && diagnostic.message
        ? [diagnostic] : []);
    const detail = entries
      .map((entry) => (typeof entry.message === 'string' ? entry.message : ''))
      .filter((message) => message)
      .join('; ');
    return mapGatewayError(wire, 'no-route', undefined, requestedModel, detail || undefined);
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
