import { createJwksService } from '../../src/oauth/jwks-service.js';
import {
  createOauthClient,
  createOauthPorts,
  createServiceClient,
  oauthNow,
  oauthUser,
} from './oauth-fixtures.js';

export const MCP_AUDIENCE = 'https://immo.sent-tech.ca/mcp';
export const RADAR_AUDIENCE = 'https://immo.sent-tech.ca';
export const ISSUER = 'http://localhost:9197';

export const workloadPolicy = {
  actorSub: 'immo-mcp-workload',
  allowClientCredentials: false,
  allowedScopes: ['immo:read', 'immo:search'],
  allowedSubjectAudiences: [MCP_AUDIENCE],
  allowedSubjectClients: ['immo-mcp'],
  allowedTargetAudiences: [RADAR_AUDIENCE],
  enabled: true,
  environment: null,
  maxTtlSeconds: 300,
};

export const publicImmoClient = () =>
  createOauthClient({
    allowedScopes: ['immo:read', 'immo:search', 'immo:documents:read'],
    clientId: 'immo-mcp',
    clientSecretHash: null,
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    resourceIndicators: [MCP_AUDIENCE],
    tokenEndpointAuthMethod: 'none',
  });

export const workloadClient = (overrides = {}) =>
  createServiceClient({
    allowedScopes: ['immo:read', 'immo:search'],
    clientId: 'immo-mcp-workload',
    clientSecretHash: 'hash:workload-secret',
    exchangePolicy: { ...workloadPolicy, ...overrides },
    resourceIndicators: [RADAR_AUDIENCE],
  });

export const mintSubject = async (
  ports: Awaited<ReturnType<typeof createOauthPorts>>['ports'],
  store: Awaited<ReturnType<typeof createOauthPorts>>['store'],
  input: { scope?: string; subjectTtlSeconds?: number } = {}
): Promise<string> => {
  const scope = input.scope ?? 'immo:read immo:search';
  const ttl = input.subjectTtlSeconds ?? 3600;
  const jwks = createJwksService({ clock: ports.clock, jwksPort: ports.jwks });
  const jti = `subject-${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(oauthNow.getTime() + ttl * 1000);
  const token = await jwks.signJwt(
    { client_id: 'immo-mcp', scope },
    { audience: MCP_AUDIENCE, expiresAt, issuer: ISSUER, jti, subject: oauthUser.id, type: 'JWT' }
  );
  await store.saveTokenMeta(
    jti,
    {
      audience: MCP_AUDIENCE,
      clientId: 'immo-mcp',
      createdAt: oauthNow,
      dpopJkt: null,
      expiresAt,
      jti,
      scope,
      tenantId: null,
      tokenType: 'access_token',
      userId: oauthUser.id,
    },
    ttl
  );
  return token;
};

export const basicAuth = (clientId: string, secret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;
