import type { Context } from 'hono';
import type { AuthCodePayload } from './state-store-types.js';
import { isCurrentOfflineGrantAuthorized } from './offline-policy.js';
import { sha256Base64url } from './crypto-utils.js';
import { oauthJsonError } from './http-utils.js';
import { authenticateClient, issueTokens, resolveDpopJkt, resolveUserinfoAudience,
  validateTokenResource, type OAuthTokenHandlerOptions } from './token-handler.js';

export const handleInitialRefresh = async (c: Context, form: URLSearchParams,
  options: OAuthTokenHandlerOptions, peek: AuthCodePayload): Promise<Response> => {
  const refresh = options.ports.oauthRefresh;
  if (!refresh) return oauthJsonError(c, 400, 'invalid_grant', 'Offline authority is unavailable.');
  return refresh.transaction(peek, async (ports) => {
    const locked = { ...options, ports };
    const auth = await authenticateClient(c, form, ports);
    if (auth instanceof Response) return auth;
    const code = await ports.oauthStateStore.findAuthCode?.(form.get('code') ?? '');
    if (!code || code.clientId !== auth.client.clientId || code.redirectUri !== form.get('redirect_uri') ||
        code.codeChallenge !== await sha256Base64url(form.get('code_verifier') ?? '')) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Authorization code is invalid.');
    }
    const resourceError = validateTokenResource(c, form, code);
    if (resourceError) return resourceError;
    const dpopJkt = await resolveDpopJkt(c, locked, auth.client, code);
    if (dpopJkt instanceof Response) return dpopJkt;
    const audience = resolveUserinfoAudience(options.issuer, c.req.raw, '/token');
    if (!await isCurrentOfflineGrantAuthorized(ports, auth.client, { ...code, dpopJkt }, options.issuer, audience)) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Offline authority is no longer valid.');
    }
    if (!await ports.oauthStateStore.consumeAuthCode(form.get('code')!)) {
      return oauthJsonError(c, 400, 'invalid_grant', 'Authorization code is already used.');
    }
    const now = ports.clock.now();
    const deadline = ports.clock.addSeconds(now, options.refreshTokenTtlSeconds ?? 1296000);
    const id = ports.random.uuid();
    const raw = `srt_${ports.random.token(32)}`;
    await ports.oauthRefresh!.save({
      id, familyId: id, parentId: null, replacedById: null, generation: 0,
      tokenHash: await ports.tokens.hashSecret(raw), clientId: code.clientId, userId: code.userId,
      tenantId: code.tenantId, scope: code.scope, offlineGrantId: code.offlineGrantId!,
      issuer: code.issuer!, audience: code.audience!, resource: code.resource ?? null,
      dpopJkt, acr: code.acr, amr: code.amr ?? [], authTime: code.authTime,
      sessionId: code.sessionId ?? null, createdAt: now, expiresAt: deadline, familyExpiresAt: deadline,
      consumedAt: null, revokedAt: null, revokedReason: null,
    });
    const user = await ports.users.findById(code.userId);
    const tokens = await issueTokens({ ...locked, accessTokenDeadline: deadline }, auth.client, code,
      user!, dpopJkt, code.audience!, id);
    ports.auditLog.record('info', 'oauth.refresh.issued', { family_id: id, client_id: code.clientId });
    return c.json({ ...tokens, refresh_token: raw });
  });
};
