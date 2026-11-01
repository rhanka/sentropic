import type { Context } from 'hono';
import type { AuthHonoPorts } from '../ports.js';
import { authenticateClient, resolveDpopJkt, resolveUserinfoAudience } from './token-handler.js';
import { isCurrentOfflineGrantAuthorized } from './offline-policy.js';
import { oauthJsonError } from './http-utils.js';

export const handleOpaqueRefresh = async (c: Context, form: URLSearchParams,
  options: { ports: AuthHonoPorts; issuer?: string; dpopIatSkewSeconds?: number },
  mode: 'revoke' | 'introspect'): Promise<Response> => {
  const auth = await authenticateClient(c, form, options.ports);
  if (auth instanceof Response) return auth;
  const store = options.ports.oauthRefresh;
  const hash = await options.ports.tokens.hashSecret(form.get('token') ?? '');
  const found = await store?.findByHash(hash);
  const inactive = () => mode === 'revoke' ? c.json({ success: true }) : c.json({ active: false });
  if (!found) return inactive();
  if (found.clientId !== auth.client.clientId) {
    return mode === 'introspect' ? inactive() : oauthJsonError(c, 400, 'invalid_grant', 'Token belongs to another client.');
  }
  if (mode === 'revoke') {
    const proof = await resolveDpopJkt(c, { ...options, issuer: options.issuer ?? found.issuer },
      { ...auth.client, dpopBoundAccessTokens: found.dpopJkt !== null },
      { ...found, codeChallenge: '', codeChallengeMethod: 'S256', redirectUri: '', nonce: null });
    if (proof instanceof Response) return proof;
  }
  return store!.transaction(found, async (ports) => {
    const live = await authenticateClient(c, form, ports);
    if (live instanceof Response) return live;
    const current = await ports.oauthRefresh!.findByHash(hash);
    if (!current) return inactive();
    const now = ports.clock.now();
    if (mode === 'revoke') {
      await ports.oauthRefresh!.revokeFamily(current.familyId, 'explicit_revoke', now);
      return inactive();
    }
    const anchor = await ports.oauthRefresh!.findAnchor(current.familyId);
    if (!anchor || current.consumedAt || current.revokedAt || anchor.revokedAt ||
        current.expiresAt <= now || current.familyExpiresAt <= now) return inactive();
    const issuer = options.issuer ?? current.issuer;
    if (!await isCurrentOfflineGrantAuthorized(ports, live.client, current, issuer,
      resolveUserinfoAudience(issuer, c.req.raw, '/introspect'))) {
      await ports.oauthRefresh!.revokeFamily(current.familyId, 'policy_denied', now);
      return inactive();
    }
    return c.json({ active: true, token_type: 'refresh_token', client_id: current.clientId,
      sub: current.userId, scope: current.scope, aud: current.audience,
      exp: Math.floor(+current.familyExpiresAt / 1000) });
  });
};
