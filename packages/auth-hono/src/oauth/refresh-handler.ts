import type { Context } from 'hono';
import type { OAuthRefreshRecord } from './refresh-types.js';
import { isCurrentOfflineGrantAuthorized, isRefreshEligibleClient } from './offline-policy.js';
import { oauthJsonError } from './http-utils.js';
import { authenticateClient, issueTokens, resolveDpopJkt, resolveUserinfoAudience,
  type OAuthTokenHandlerOptions } from './token-handler.js';

export const handleRefreshToken = async (c: Context, form: URLSearchParams,
  options: OAuthTokenHandlerOptions): Promise<Response> => {
  const auth = await authenticateClient(c, form, options.ports);
  if (auth instanceof Response) return auth;
  const store = options.ports.oauthRefresh;
  if (!store) return oauthJsonError(c, 400, 'unauthorized_client', 'Refresh is not enabled.');
  const hash = await options.ports.tokens.hashSecret(form.get('refresh_token') ?? '');
  const found = await store.findByHash(hash);
  if (!found) return oauthJsonError(c, 400,
    isRefreshEligibleClient(auth.client) ? 'invalid_grant' : 'unauthorized_client', 'Refresh grant is invalid.');
  if (found.clientId !== auth.client.clientId) {
    return oauthJsonError(c, 400, 'invalid_grant', 'Refresh grant is invalid.');
  }
  // Prove the original binding before any destructive policy/replay handling.
  const proof = await resolveDpopJkt(c, options,
    { ...auth.client, dpopBoundAccessTokens: found.dpopJkt !== null }, asCode(found));
  if (proof instanceof Response) return proof;
  return store.transaction(found, async (ports) => {
    const locked = { ...options, ports };
    const live = await authenticateClient(c, form, ports);
    if (live instanceof Response) return live;
    const current = await ports.oauthRefresh!.findByHash(hash);
    const anchor = current && await ports.oauthRefresh!.findAnchor(current.familyId);
    const now = ports.clock.now();
    if (!current || !anchor || current.revokedAt || anchor.revokedAt) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Refresh grant is invalid.');
    }
    if (current.consumedAt) {
      await ports.oauthRefresh!.revokeFamily(current.familyId, 'reuse_detected', now);
      ports.auditLog.record('warn', 'oauth.refresh.reuse_detected', {
        family_id: current.familyId, client_id: current.clientId, user_id: current.userId,
        replayed_generation: current.generation,
      });
      return oauthJsonError(c, 400, 'invalid_grant', 'Refresh grant is invalid.');
    }
    const audience = resolveUserinfoAudience(options.issuer, c.req.raw, '/token');
    if (!await isCurrentOfflineGrantAuthorized(ports, live.client, current, options.issuer, audience)) {
      await ports.oauthRefresh!.revokeFamily(current.familyId, 'policy_denied', now);
      return oauthJsonError(c, 400, 'invalid_grant', 'Refresh authority is no longer valid.');
    }
    const remaining = Math.floor((+current.familyExpiresAt - +now) / 1000);
    if (remaining <= 0 || current.expiresAt <= now) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Refresh grant has expired.');
    }
    const requested = form.has('scope') ? form.get('scope')!.split(/\s+/).filter(Boolean) : current.scope.split(' ');
    if (!requested.length || requested.some((scope) => !current.scope.split(' ').includes(scope))) {
      return oauthJsonError(c, 400, 'invalid_scope', 'Requested scopes exceed the original grant.');
    }
    const resources = form.getAll('resource');
    if (resources.length > 1 || (resources.length === 1 && resources[0] !== current.resource)) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Resource does not match the original grant.');
    }
    const childId = ports.random.uuid();
    const raw = `srt_${ports.random.token(32)}`;
    if (!await ports.oauthRefresh!.consume(current.id, childId, now)) {
      throw new Error('Locked refresh leaf changed.');
    }
    await ports.oauthRefresh!.save({ ...current, id: childId, parentId: current.id,
      tokenHash: await ports.tokens.hashSecret(raw), generation: current.generation + 1,
      createdAt: now, consumedAt: null, replacedById: null });
    const user = await ports.users.findById(current.userId);
    const tokens = await issueTokens({ ...locked, accessTokenTtlSeconds:
      Math.min(options.accessTokenTtlSeconds ?? 3600, remaining) }, live.client,
      { ...asCode(current), scope: requested.join(' '), createdAt: now }, user!, current.dpopJkt,
      current.audience, current.familyId, false);
    ports.auditLog.record('info', 'oauth.refresh.rotated', {
      family_id: current.familyId, generation: current.generation + 1, client_id: current.clientId,
    });
    return c.json({ ...tokens, refresh_token: raw });
  });
};

const asCode = (row: OAuthRefreshRecord) => ({ ...row, codeChallenge: '',
  codeChallengeMethod: 'S256' as const, redirectUri: '', nonce: null });
