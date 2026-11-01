import type { Context } from 'hono';
import { decodeJwt } from 'jose';

import type { AuthHonoPorts } from '../ports.js';
import { OAuthDpopProofError, verifyOAuthDpopProof } from './dpop.js';
import { oauthJsonError } from './http-utils.js';
import { handleOpaqueRefresh } from './opaque-refresh-handler.js';
import { authenticateClient } from './token-handler.js';

export interface OAuthRevokeHandlerOptions {
  dpopIatSkewSeconds?: number;
  ports: AuthHonoPorts;
}

export const createOAuthRevokeHandler =
  (options: OAuthRevokeHandlerOptions) =>
  async (c: Context): Promise<Response> => {
    const form = new URLSearchParams(await c.req.text());
    const token = form.get('token');
    if (!token) return oauthJsonError(c, 400, 'invalid_request', 'token is required.');
    if (token.startsWith('srt_')) return handleOpaqueRefresh(c, form, options, 'revoke');

    const jti = decodeTokenJti(token);
    if (!jti) return c.json({ success: true });

    const meta = await options.ports.oauthStateStore.findTokenMeta(jti);
    if (meta?.refreshFamilyId && options.ports.oauthRefresh) {
      const auth = await authenticateClient(c, form, options.ports);
      if (auth instanceof Response) return auth;
      if (auth.client.clientId !== meta.clientId) return oauthJsonError(c, 400, 'invalid_grant', 'Token ownership mismatch.');
      return options.ports.oauthRefresh.transaction({ ...meta, familyId: meta.refreshFamilyId }, async (ports) => {
        await ports.oauthRefresh!.revokeFamily(meta.refreshFamilyId!, 'explicit_revoke', ports.clock.now());
        return c.json({ success: true });
      });
    }
    if (meta?.dpopJkt) {
      const dpop = await validateRevokeDpop(c, options, token, meta.dpopJkt);
      if (dpop instanceof Response) return dpop;
    }

    await options.ports.oauthStateStore.revokeToken(jti);
    return c.json({ success: true });
  };

const validateRevokeDpop = async (
  c: Context,
  options: OAuthRevokeHandlerOptions,
  accessToken: string,
  expectedJkt: string
): Promise<null | Response> => {
  const proof = c.req.header('dpop');
  if (!proof) return oauthJsonError(c, 400, 'invalid_dpop_proof', 'DPoP proof is required.');

  try {
    const verified = await verifyOAuthDpopProof({
      accessToken,
      htm: 'POST',
      htu: c.req.url,
      iatSkewSeconds: options.dpopIatSkewSeconds,
      ports: options.ports,
      proof,
    });
    if (verified.jkt !== expectedJkt) {
      return oauthJsonError(c, 400, 'invalid_dpop_proof', 'DPoP proof key does not match the token.');
    }
    return null;
  } catch (error) {
    if (error instanceof OAuthDpopProofError) {
      return oauthJsonError(c, 400, 'invalid_dpop_proof', error.message);
    }
    throw error;
  }
};

const decodeTokenJti = (token: string): string | null => {
  try {
    const payload = decodeJwt(token);
    return typeof payload.jti === 'string' ? payload.jti : null;
  } catch {
    return null;
  }
};
