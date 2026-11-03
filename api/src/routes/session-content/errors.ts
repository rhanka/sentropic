import { relayError, type RelayError, type RelayErrorCode } from '@sentropic/cluster-mesh';

/** SessionRelayErrorV1 (relay refusal family), reusing the merged RC2.registry code union. */
export type { RelayError, RelayErrorCode };
export { relayError };

export type ViewErrorCode =
  | 'authentication_required' | 'view_refused' | 'cursor_invalid'
  | 'cursor_gone' | 'view_stale' | 'view_unavailable' | 'unsupported_version';

export interface ViewError {
  readonly format: 'sentropic.remote-session-view/1';
  readonly kind: 'error';
  readonly code: ViewErrorCode;
}

export const viewError = (code: ViewErrorCode): ViewError =>
  ({ format: 'sentropic.remote-session-view/1', kind: 'error', code });

/** Frozen RC0 HTTP union codes for the policy routes (producer-owned shapes). */
export type Rc0HttpCode =
  | 'invalid_request' | 'unsupported_version' | 'authentication_required'
  | 'authority_refused' | 'authority_unavailable' | 'origin_refused' | 'oversize';

export interface Rc0HttpError { readonly error: Rc0HttpCode }

export class ReceiverRefusal extends Error {
  constructor(
    readonly family: 'relay' | 'view' | 'rc0-http',
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
    this.name = 'ReceiverRefusal';
  }
}

export const relayRefusal = (code: RelayErrorCode, retryable = false): ReceiverRefusal =>
  new ReceiverRefusal('relay', code, retryable);
export const viewRefusal = (code: ViewErrorCode): ReceiverRefusal =>
  new ReceiverRefusal('view', code);
export const rc0Refusal = (code: Rc0HttpCode): ReceiverRefusal =>
  new ReceiverRefusal('rc0-http', code);

/** Annex-D refusal status profile. Guard refusals never become success-shaped ACKs. */
export const refusalStatus = (family: 'relay' | 'view' | 'rc0-http', code: string): number => {
  if (family === 'view') {
    return code === 'authentication_required' ? 401
      : code === 'unsupported_version' ? 426
      : code === 'cursor_invalid' || code === 'cursor_gone' ? 410
      : code === 'view_unavailable' ? 503 : 403;
  }
  if (family === 'rc0-http') {
    return code === 'invalid_request' ? 400
      : code === 'authentication_required' ? 401
      : code === 'authority_refused' ? 403
      : code === 'origin_refused' ? 403
      : code === 'oversize' ? 413
      : code === 'unsupported_version' ? 426
      : 503;
  }
  switch (code as RelayErrorCode) {
    case 'relay_auth_required': return 401;
    case 'relay_origin_refused': return 403;
    case 'relay_scope_refused': return 403;
    case 'relay_consent_refused': return 403;
    case 'relay_lane_refused': return 403;
    case 'relay_stale_generation': return 409;
    case 'relay_route_conflict': return 409;
    case 'relay_frame_conflict': return 409;
    case 'relay_protocol_refused': return 400;
    case 'relay_oversize': return 413;
    case 'relay_version_unsupported': return 426;
    case 'relay_backpressure': return 429;
    case 'relay_grant_expired': return 410;
    case 'relay_grant_revoked': return 403;
    case 'relay_loop': return 403;
    case 'relay_hop_limit': return 403;
    case 'relay_grant_unavailable': return 503;
    case 'relay_unavailable': return 503;
    case 'relay_policy_unavailable': return 503;
  }
};

export const refusalBody = (refusal: ReceiverRefusal): RelayError | ViewError | Rc0HttpError => {
  if (refusal.family === 'relay') return relayError(refusal.code as RelayErrorCode, refusal.retryable);
  if (refusal.family === 'view') return viewError(refusal.code as ViewErrorCode);
  return { error: refusal.code as Rc0HttpCode };
};

/**
 * Annex-D HTTP profile (R-6): receive only `application/json` optionally followed by a
 * single `charset=utf-8` parameter; identity content-encoding only; bodyless routes
 * (maxRequestBytes 0) refuse any entity bytes before allocation.
 */
export const JSON_MEDIA = /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i;

type MediaRoute = { readonly maxRequestBytes: number; readonly refusal: 'relay' | 'view' | 'rc0-http' };

/**
 * Annex-D refusal-code mapping (r3 N2): invalid entities map to `invalid_request` on
 * RC0/policy routes, `view_refused` on additive browser routes and
 * `relay_protocol_refused` on additive mesh routes; no new code. Oversize maps to
 * `oversize` on RC0/policy routes and `relay_oversize` on mesh routes.
 */
export const entityRefusal = (route: MediaRoute): ReceiverRefusal =>
  route.refusal === 'rc0-http' ? rc0Refusal('invalid_request')
    : route.refusal === 'view' ? viewRefusal('view_refused')
    : relayRefusal('relay_protocol_refused');

export const oversizeRefusal = (route: MediaRoute): ReceiverRefusal =>
  route.refusal === 'rc0-http' ? rc0Refusal('oversize')
    : route.refusal === 'view' ? viewRefusal('view_refused')
    : relayRefusal('relay_oversize');

export const checkRequestMedia = (
  route: MediaRoute,
  headers: Headers,
): ReceiverRefusal | null => {
  const declared = headers.get('content-length');
  const hasBody = declared !== null && declared !== '0' || headers.get('transfer-encoding') !== null;
  if (route.maxRequestBytes === 0 && hasBody) {
    return entityRefusal(route); // zero entity bytes; any entity refuses before allocation
  }
  if (route.maxRequestBytes > 0) {
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > route.maxRequestBytes)) {
      return oversizeRefusal(route);
    }
    const type = headers.get('content-type');
    if (type !== null && !JSON_MEDIA.test(type)) return entityRefusal(route);
  }
  if (headers.get('content-encoding') !== null) return entityRefusal(route);
  return null;
};
