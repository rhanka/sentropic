import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { appendParams, oauthJsonError, redirectOrJson } from './http-utils.js';
import { issueAuthorizedCode } from './issue-authorized-code.js';
import type { OAuthContinuationCodec, OAuthContinuationState } from './state-codec.js';
import { resolveOAuthSession } from './session-resolver.js';

export interface OAuthConsentHandlerOptions {
  authorizationCodeTtlSeconds?: number;
  /** RFC 9207 authorization-server issuer identifier, echoed as `iss` on the RP redirect. */
  issuer: string;
  ports: AuthHonoPorts;
  stateCodec: OAuthContinuationCodec;
}

export const createOAuthConsentDetailsHandler =
  (options: OAuthConsentHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const state = c.req.query('state') ?? '';
    const payload = await validateConsentState(c, options, state);
    if (payload instanceof Response) return payload;

    const client = await options.ports.oauthStateStore.findClient(payload.clientId);
    if (!client) return oauthJsonError(c, 400, 'invalid_request', 'Unknown OAuth client.');

    return c.json({
      clientName: client.name,
      redirectUri: payload.redirectUri,
      scopes: payload.scope.split(/\s+/).filter(Boolean),
    });
  };

export const createOAuthConsentDecisionHandler =
  (options: OAuthConsentHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    // Accept BOTH a native form POST (x-www-form-urlencoded → the browser follows the resulting
    // 302; the final RP navigation no longer depends on JS once the form is rendered — the
    // prod-regression fix) and a JSON fetch (programmatic clients, 200+JSON). The request's Accept
    // header drives the response shape in redirectOrJson:
    // a native form sends Accept: text/html → 302 navigable; a fetch sends Accept: application/json
    // → 200+JSON.
    const contentType = c.req.header('content-type') ?? '';
    let decision: string | undefined;
    let state: string | undefined;
    if (contentType.includes('form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await c.req.parseBody().catch(() => null);
      decision = typeof form?.decision === 'string' ? form.decision : undefined;
      state = typeof form?.state === 'string' ? form.state : undefined;
    } else {
      const json = await c.req.json<{ decision?: string; state?: string }>().catch(() => null);
      decision = json?.decision;
      state = json?.state;
    }
    if (!state || !['approve', 'deny'].includes(decision ?? '')) {
      return oauthJsonError(c, 400, 'invalid_request', 'Consent decision and state are required.');
    }

    const payload = await validateConsentState(c, options, state);
    if (payload instanceof Response) return payload;

    if (decision === 'deny') {
      return redirectOrJson(
        c,
        // RFC 9207: echo the AS issuer as `iss` on the access_denied authorization response.
        appendParams(
          payload.redirectUri,
          { error: 'access_denied', iss: options.issuer, state: payload.state },
          c.req.url
        )
      );
    }

    // Persist the grant so subsequent authorize requests for a covered scope set skip consent.
    // Approve-only: a deny never records a grant. Absent consentStore ⇒ legacy (no persistence).
    // ARCH-11 G1c (§4.2.5): record the grant under the org this authorize is scoped to (the tenant
    // `sealContinuation` already derived + sealed). Under strict the adapter keys on it; under
    // alias/shadow it is ignored (byte-identical).
    if (options.ports.consentStore && payload.userId) {
      await options.ports.consentStore.saveGrant(
        payload.userId,
        payload.clientId,
        payload.scope.split(/\s+/).filter(Boolean),
        payload.tenantId ?? undefined
      );
    }

    return issueAuthorizedCode(c, options, payload);
  };

const validateConsentState = async (
  c: Context,
  options: OAuthConsentHandlerOptions,
  sealedState: string
): Promise<OAuthContinuationState | Response> => {
  const payload = await options.stateCodec.unseal(sealedState);
  if (!payload || !payload.userId || new Date(payload.expiresAt) <= options.ports.clock.now()) {
    return oauthJsonError(c, 400, 'invalid_request', 'OAuth consent state is invalid or expired.');
  }

  const session = await resolveOAuthSession(c.req.raw, options.ports);
  if (!session || session.user.id !== payload.userId) {
    return oauthJsonError(c, 401, 'login_required', 'A valid user session is required.');
  }

  return payload;
};
