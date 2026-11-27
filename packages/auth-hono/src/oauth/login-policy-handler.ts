import type { Context } from 'hono';

import type { OAuthAuthorizeHandlerOptions } from './authorize-handler.js';
import { oauthJsonError } from './http-utils.js';

/**
 * Resolve the per-client IdP login-screen policy from a sealed OAuth continuation.
 * Unsealing `continue` ensures a caller cannot forge a policy flag for another client.
 */
export const createOAuthLoginPolicyHandler =
  (options: Pick<OAuthAuthorizeHandlerOptions, 'ports' | 'stateCodec'>) =>
  async (c: Context): Promise<Response> => {
    const continuation = c.req.query('continue');
    if (!continuation) {
      return c.json({ magicLinkSignIn: false });
    }

    let payload = null;
    try {
      payload = await options.stateCodec.unseal(continuation);
    } catch {
      payload = null;
    }
    const now = options.ports.clock.now();
    if (!payload || payload.userId || payload.codeChallengeMethod !== 'S256' || new Date(payload.expiresAt) <= now) {
      return oauthJsonError(c, 400, 'invalid_request', 'OAuth continuation is invalid or expired.');
    }

    const client = await options.ports.oauthStateStore.findClient(payload.clientId);
    if (!client) {
      return oauthJsonError(c, 400, 'invalid_request', 'Unknown OAuth client.');
    }

    return c.json({ magicLinkSignIn: Boolean(client.magicLinkSignIn) });
  };
