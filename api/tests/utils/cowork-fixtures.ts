// Shared fixtures for Cowork MCP API tests (BR-41d, Lot 1). Minted JWTs alone
// carry no oauth_tokens row, so the valid cases insert token meta explicitly.
import { createJwksService } from '@sentropic/auth-hono';
import { eq } from 'drizzle-orm';

import { db } from '../../src/db/client';
import { oauthClients, oauthTokens, revokedTokens } from '../../src/db/schema';
import { createJwksAdapter, type JwksAdapter } from '../../src/services/auth/jwks-adapter';
import { createOauthStateStoreAdapter } from '../../src/services/auth/oauth-state-adapter';
import { resetCoworkMcpAuthCache } from '../../src/routes/cowork-mcp';
import { cleanupAuthData } from './auth-helper';

export const COWORK_TEST_RESOURCE = 'https://preprod.sentropic.sent-tech.ca/api/v1/cowork-mcp';
export const COWORK_TEST_ISSUER = 'https://preprod.auth.sent-tech.ca';
export const COWORK_TEST_CLIENT_ID = 'cowork-test-client';
export const COWORK_TEST_HMAC_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64url');

export interface CoworkTestEnv {
  ownerSub: string;
  clientId?: string;
  resource?: string;
  issuer?: string;
}

export const enableCoworkEnv = (setup: CoworkTestEnv): void => {
  process.env.COWORK_REMOTE_ENABLED = 'true';
  process.env.COWORK_MCP_RESOURCE_URI = setup.resource ?? COWORK_TEST_RESOURCE;
  process.env.COWORK_MCP_AUTHORIZATION_SERVER_URL = setup.issuer ?? COWORK_TEST_ISSUER;
  process.env.COWORK_OWNER_SUB = setup.ownerSub;
  process.env.COWORK_MCP_CLIENT_ID = setup.clientId ?? COWORK_TEST_CLIENT_ID;
  process.env.COWORK_OPERATION_HMAC_KEY = COWORK_TEST_HMAC_KEY;
};

export const disableCoworkEnv = (): void => {
  for (const key of Object.keys(process.env).filter((name) => name.startsWith('COWORK_'))) {
    delete process.env[key];
  }
  resetCoworkMcpAuthCache();
};

export const ensureCoworkSigningKey = async (): Promise<JwksAdapter> => {
  const jwks = createJwksAdapter();
  if (await jwks.getActiveKey()) return jwks;
  try {
    await jwks.generateAndStoreNewKey({ kid: 'cowork-mcp-test-kid' });
  } catch (error) {
    if (!String(error).includes('duplicate key value')) throw error;
  }
  return createJwksAdapter();
};

export interface CoworkTokenParams {
  subject: string;
  clientId: string;
  scopes: string[];
  issuer?: string;
  resource?: string;
  jti?: string;
  expInSec?: number;
}

export const mintCoworkToken = async (
  jwks: JwksAdapter,
  params: CoworkTokenParams,
): Promise<{ token: string; jti: string }> => {
  const now = new Date();
  const jti = params.jti ?? `cowork-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const token = await createJwksService({
    clock: { addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000), now: () => now },
    jwksPort: jwks,
  }).signJwt(
    { client_id: params.clientId, scope: params.scopes.join(' ') },
    {
      audience: params.resource ?? COWORK_TEST_RESOURCE,
      expiresAt: new Date(now.getTime() + (params.expInSec ?? 3600) * 1000),
      issuer: params.issuer ?? COWORK_TEST_ISSUER,
      jti,
      subject: params.subject,
      type: 'JWT',
    },
  );
  return { jti, token };
};

export const saveCoworkTokenMeta = async (
  jti: string,
  meta: { userId: string; clientId: string; scope: string; audience?: string; ttlSec?: number },
): Promise<void> => {
  const now = new Date();
  await createOauthStateStoreAdapter().saveTokenMeta(
    jti,
    {
      audience: meta.audience ?? COWORK_TEST_RESOURCE,
      clientId: meta.clientId,
      createdAt: now,
      dpopJkt: null,
      expiresAt: new Date(now.getTime() + (meta.ttlSec ?? 3600) * 1000),
      jti,
      scope: meta.scope,
      tenantId: null,
      tokenType: 'access_token',
      userId: meta.userId,
    },
    meta.ttlSec ?? 3600,
  );
};

export const seedCoworkClient = async (
  clientId: string,
  resource: string,
  scopes: string[] = ['cowork:control'],
): Promise<void> => {
  const now = new Date();
  await db.insert(oauthClients).values({
    allowedScopes: scopes,
    clientId,
    createdAt: now,
    id: `cowork-test-${clientId}`,
    name: 'Cowork test client',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    resourceIndicators: [resource],
    updatedAt: now,
  }).onConflictDoUpdate({
    set: { allowedScopes: scopes, resourceIndicators: [resource], updatedAt: now },
    target: oauthClients.clientId,
  });
};

export const revokeCoworkToken = async (jti: string): Promise<void> => {
  await createOauthStateStoreAdapter().revokeToken(jti);
};

export const cleanupCoworkData = async (clientIds: string[], jtis: string[]): Promise<void> => {
  for (const jti of jtis) {
    await db.delete(revokedTokens).where(eq(revokedTokens.jti, jti));
    await db.delete(oauthTokens).where(eq(oauthTokens.jti, jti));
  }
  for (const clientId of clientIds) {
    await db.delete(oauthClients).where(eq(oauthClients.clientId, clientId));
  }
  await cleanupAuthData();
};
