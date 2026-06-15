import type { Context } from 'hono';

import type { AuthHonoPorts } from '../ports.js';
import { appendParams, oauthJsonError, redirectOrJson } from './http-utils.js';
import { issueAuthorizedCode } from './issue-authorized-code.js';
import type { OAuthContinuationCodec, OAuthContinuationState } from './state-codec.js';
import { resolveOAuthSession } from './session-resolver.js';

export interface OAuthConsentHandlerOptions {
  authorizationCodeTtlSeconds?: number;
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
    const body = await c.req.json<{ decision?: string; state?: string }>().catch(() => null);
    if (!body?.state || !['approve', 'deny'].includes(body.decision ?? '')) {
      return oauthJsonError(c, 400, 'invalid_request', 'Consent decision and state are required.');
    }

    const payload = await validateConsentState(c, options, body.state);
    if (payload instanceof Response) return payload;

    if (body.decision === 'deny') {
      return redirectOrJson(
        c,
        appendParams(payload.redirectUri, { error: 'access_denied', state: payload.state }, c.req.url)
      );
    }

    // Persist the grant so subsequent authorize requests for a covered scope set skip consent.
    // Approve-only: a deny never records a grant. Absent consentStore ⇒ legacy (no persistence).
    if (options.ports.consentStore && payload.userId) {
      await options.ports.consentStore.saveGrant(
        payload.userId,
        payload.clientId,
        payload.scope.split(/\s+/).filter(Boolean)
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
