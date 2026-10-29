import { fromJwksPort, verifyAccessToken } from '@sentropic/oauth-verify';
import { getSentropicOAuthPorts } from '../../routes/auth/oauth';
import { persistRemoteSessionRevocation } from './remote-revocation';

export function createRemoteIdpRevocationPorts() {
  return {
    async authenticate(request: Request): Promise<string | null> {
      try {
        const issuer = process.env.OAUTH_ISSUER_URL;
        const clientId = process.env.REMOTE_ACTION_REVOCATION_CLIENT_ID;
        const resource = process.env.REMOTE_ACTION_REVOCATION_RESOURCE;
        const authorization = request.headers.get('authorization');
        if (process.env.REMOTE_ACTION_ROLE !== 'auth-idp' || !issuer || !clientId || !resource
          || !authorization?.startsWith('Bearer ')) return null;
        const claims = await verifyAccessToken({ token: authorization.slice(7), issuer, audience: resource,
          keySource: fromJwksPort(getSentropicOAuthPorts().jwks), requiredScopes: ['remote.sessions.revoke'], now: new Date() });
        return claims.client_id === clientId && claims.sub === clientId && !claims.cnf
          && typeof claims.exp === 'number' ? claims.client_id : null;
      } catch { return null; }
    },
    revoke: persistRemoteSessionRevocation,
  };
}
