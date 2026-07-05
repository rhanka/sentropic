import { createAuthClient } from '@sentropic/auth-client';
// E2/F8 relocation: the canonical RS middleware now lives in @sentropic/mcp-auth/hono.
import { createRequireServiceAuth, type ServiceAuthPorts } from '@sentropic/mcp-auth/hono';
import { Hono, type Context } from 'hono';

import { env } from '../../config/env';
import { logger } from '../../logger';
import { getSentropicOAuthPorts, resolveOAuthIssuer, resolveOAuthServiceResource } from './oauth';

/**
 * Service-to-service (S2S) host wiring (BR-39d Lot 5).
 *
 * - `GET /ping`: a resource-server route protected by `createRequireServiceAuth`
 *   (requires the `service:ping` scope and an audience matching this API's
 *   resource URI). This is the resource-server side of the contract.
 * - `GET /self-check`: dogfoods `@sentropic/auth-client` (BR39d-D10) by minting a
 *   token via the `client_credentials` grant against this API's own IdP and
 *   calling the protected `/ping` route — the activation + UAT artifact.
 */
export const serviceS2sRouter = new Hono();

const SERVICE_PING_SCOPE = 'service:ping';

const buildServiceAuthPorts = (): ServiceAuthPorts => {
  const ports = getSentropicOAuthPorts();
  return {
    clock: ports.clock,
    dpopReplay: { recordDpopJti: ports.oauthStateStore.recordDpopJti },
    jwks: ports.jwks,
  };
};

const requireServicePing = (c: Context, next: () => Promise<void>) =>
  createRequireServiceAuth({
    issuer: resolveOAuthIssuer(c.req.raw),
    ports: buildServiceAuthPorts(),
    requiredScopes: [SERVICE_PING_SCOPE],
    resource: resolveOAuthServiceResource(c.req.raw),
  })(c, next);

serviceS2sRouter.get('/ping', requireServicePing, (c) => {
  const serviceClient = c.get('serviceClient') as { clientId?: string } | undefined;
  return c.json({ clientId: serviceClient?.clientId ?? null, service: 's2s', status: 'ok' });
});

serviceS2sRouter.get('/self-check', async (c) => {
  const clientId = env.OAUTH_SELF_SERVICE_CLIENT_ID;
  const clientSecret = env.OAUTH_SELF_SERVICE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.json(
      { error: 'self_service_client_not_configured', status: 'skipped' },
      503,
    );
  }

  const issuer = resolveOAuthIssuer(c.req.raw);
  const resource = resolveOAuthServiceResource(c.req.raw);
  const origin = new URL(c.req.url).origin;

  try {
    const authClient = createAuthClient({
      clientId,
      clientSecret,
      issuer,
      resource,
      scope: [SERVICE_PING_SCOPE],
    });
    const token = await authClient.getToken();

    const pingResponse = await fetch(`${origin}/api/v1/auth/s2s/ping`, {
      headers: { authorization: `${token.token_type} ${token.access_token}` },
    });
    const pingBody = await pingResponse.json().catch(() => null);

    return c.json({
      issuer,
      ping: { body: pingBody, status: pingResponse.status },
      resource,
      status: pingResponse.ok ? 'ok' : 'failed',
      tokenType: token.token_type,
    });
  } catch (error) {
    logger.error({ err: error }, 'S2S self-check failed');
    return c.json({ error: 'self_check_failed', status: 'failed' }, 502);
  }
});
