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
import { requestTooLargeDetail, type RequestSizeDetail } from '@sentropic/llm-mesh';
import { requestTooLargeMessage } from '../request-too-large.js';
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
  | 'native-required'
  | 'native-max-tokens-required'
  | 'native-unavailable'
  | 'unknown-model'
  | 'no-route'
  | 'request-too-large'
  | 'request-body-capacity'
  | 'cross-user-disabled';

export interface NativeValidationPublicDetail {
  readonly type: string;
  readonly message: string;
}

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
     * Client-safe field path: gateway-built literals, plus unknown caller
     * keys echoed charset-gated (a restricted echo to the caller itself,
     * never a reflection vector). Rendered only for `bad-request` on
     * OpenAI-shaped wires.
     */
    readonly param?: string,
    /** Trusted measured size for `request-too-large`; never caller text. */
    readonly requestSize?: RequestSizeDetail,
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

/**
 * Field paths are gateway-built literals, except unknown caller keys (e.g.
 * an unsupported top-level field) which echo back charset-gated: anything
 * outside this pattern is dropped, so the echo reaches only the caller
 * itself and carries no markup or quoting (R4-MIN-9).
 */
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
  /** Trusted measured size, `request-too-large` only. */
  requestSize?: RequestSizeDetail,
  /** Native validation public detail; a typed 400 on any kind. */
  validation?: NativeValidationPublicDetail,
): ProviderShapedError => {
  const anthropic = wire === 'anthropic-messages';
  const retry = retryAfterHeader(retryAfterSeconds);
  if (validation) {
    return anthropic
      ? anthropicError(400, validation.type, validation.message)
      : openAiError(400, validation.type, validation.message, 'invalid_request');
  }

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

    case 'request-too-large': {
      // N02: terminal 413 carries only measured numeric evidence with the
      // effective known limit; unknown upstream limits stay unavailable.
      // Non-retryable on every wire, even when wrapped by callbacks.
      const message = requestTooLargeMessage(requestSize);
      const headers = { 'x-should-retry': 'false' };
      return anthropic
        ? anthropicError(413, 'request_too_large', message, headers)
        : openAiError(413, 'invalid_request_error', message, 'request_too_large', headers);
    }

    case 'request-body-capacity': {
      // N03: capacity exhaustion is retryable with a 1s hint; no waiting
      // queue, quote, hold, dispatch or financial event follows. The N05
      // reader raises this kind; the pool below never waits. The literal
      // duplicates REQUEST_BODY_CAPACITY_MESSAGE to avoid an import cycle.
      const message = 'Gateway request body capacity is temporarily exhausted; retry later.';
      const headers = { 'Retry-After': '1', 'x-should-retry': 'true' };
      return anthropic
        ? anthropicError(503, 'api_error', message, headers)
        : openAiError(503, 'api_error', message, 'request_body_capacity', headers);
    }

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
    return mapGatewayError(wire, error.kind, error.retryAfterSeconds, requestedModel, undefined, field,
      error.requestSize, error.validation);
  }
  const validation = error && typeof error === 'object' && 'validation' in error
    ? (error as { validation?: NativeValidationPublicDetail }).validation
    : undefined;
  if (validation && typeof validation.type === 'string' && typeof validation.message === 'string') {
    return wire === 'anthropic-messages'
      ? anthropicError(400, validation.type, validation.message)
      : openAiError(400, validation.type, validation.message, 'invalid_request');
  }
  // N02: typed 413 evidence survives wrapping (callbacks, settlement, SDK
  // adapters) and maps before auth/rate/overload handling below.
  const tooLarge = requestTooLargeDetail(error);
  if (tooLarge) {
    return mapGatewayError(wire, 'request-too-large', undefined, requestedModel, undefined, undefined,
      tooLarge.requestSize);
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
  if (isRoutePlanError(error, 'native-unavailable') || isRouteQuoteError(error, 'native-unavailable')) {
    return mapGatewayError(wire, 'native-unavailable');
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
  // N21: raw upstream failures (native dispatch skips kind mapping) keep
  // their provider shape without leaking detail.
  const upstreamStatus = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined;
  const upstreamCode = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : undefined;
  if (upstreamCode === 'native_protocol_error') return anthropicError(503, 'api_error', 'upstream protocol failure');
  if (upstreamStatus === 404) return mapGatewayError(wire, 'unknown-model', undefined, requestedModel);
  if (upstreamStatus === 429) {
    const retryAfterMs = error && typeof error === 'object'
      && typeof (error as { retryAfterMs?: unknown }).retryAfterMs === 'number'
      ? (error as { retryAfterMs: number }).retryAfterMs : undefined;
    return mapGatewayError(wire, 'upstream-rate-limited',
      retryAfterMs === undefined ? undefined : retryAfterMs / 1000);
  }
  if (upstreamStatus === 413) {
    const type = 'request_too_large';
    return wire === 'anthropic-messages' ? anthropicError(upstreamStatus, type, 'upstream request failed')
      : openAiError(upstreamStatus, type, 'upstream request failed');
  }
  // Unknown internal failure — never leak the message; map to a generic
  // provider availability error (NOT the internal detail).
  return wire === 'anthropic-messages'
    ? anthropicError(503, 'overloaded_error', 'service temporarily unavailable')
    : openAiError(503, 'rate_limit_error', 'service temporarily unavailable', 'overloaded');
};

/** Terminal numeric refusal from any wrapped size evidence; the served target preserves the actual-model header. */
export const gatewayRequestTooLargeError = (error: unknown, target?: ResolvedTarget): GatewayError | undefined => {
  const detail = requestTooLargeDetail(error);
  return detail ? new GatewayError('request-too-large', 'Request body is too large', undefined,
    target, undefined, undefined, detail.requestSize) : undefined;
};

/** Map a gateway condition to a provider-shaped error for the given wire (spec §3b). */
export const notImplemented = (wire: GatewayWire): ProviderShapedError =>
  wire === 'anthropic-messages'
    ? anthropicError(501, 'api_error', 'gateway path not implemented in v0 scaffold')
    : openAiError(501, 'server_error', 'gateway path not implemented in v0 scaffold', 'not_implemented');
