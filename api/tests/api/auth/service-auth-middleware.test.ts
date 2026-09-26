import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import { serviceClients, tenants, workspaces } from '../../../src/db/schema';
import { getSentropicOAuthPorts } from '../../../src/routes/auth/oauth';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';
import { createLlmCallerIdentity } from '../../../src/services/llm-identity/caller-auth';
import { createLlmIdentityDirectory } from '../../../src/services/llm-identity/directory';
// Product code imports gateway source by relative path until B3c (BRDP-EX9) adds the dependency.
import { VerifiedCostContextResolver } from '../../../../packages/llm-gateway/src/cost-context';
import { ServiceAuthVerifyToken } from '../../../../packages/llm-gateway/src/caller-auth/service-auth';
import { PersonalPassthroughCallerAuth } from '../../../../packages/llm-gateway/src/personal-passthrough/caller-auth';

const ISSUER = 'http://localhost:9197';
const RESOURCE = ISSUER;
const CLIENT_ID = 'test-service-rp';
const CLIENT_SECRET = 'test-service-rp-secret-dev-only';
const PING_URL = `${ISSUER}/api/v1/oauth/s2s/ping`;
const TOKEN_URL = `${ISSUER}/api/v1/oauth/token`;

describe('S2S createRequireServiceAuth host route', () => {
  beforeEach(async () => {
    await ensureActiveSigningKey('test-s2s-kid');
    await seedServiceClient();
  });

  afterEach(async () => {
    await db.delete(serviceClients).where(eq(serviceClients.clientId, CLIENT_ID));
  });

  it('mints a token via client_credentials and calls the protected route (200)', async () => {
    const token = await mintToken('service:ping');

    const response = await app.request(PING_URL, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      clientId: CLIENT_ID,
      service: 's2s',
      status: 'ok',
    });
  });

  it('rejects a request with no token (401)', async () => {
    const response = await app.request(PING_URL);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('rejects a token missing the required scope (403)', async () => {
    const token = await mintToken('service:read');

    const response = await app.request(PING_URL, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  it('rejects a token minted for the wrong resource/audience (401)', async () => {
    await db
      .update(serviceClients)
      .set({ resourceIndicators: [RESOURCE, 'http://localhost:9197/other'] })
      .where(eq(serviceClients.clientId, CLIENT_ID));
    const token = await mintToken('service:ping', 'http://localhost:9197/other');

    const response = await app.request(PING_URL, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });
});

describe('S2S token through the LLM gateway caller identity (Lot D B2)', () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const TENANT = `llm-s2s-tenant-${suffix}`;
  const WORKSPACE = `llm-s2s-ws-${suffix}`;
  const context = { method: 'POST', url: `${ISSUER}/v1/messages`, requestId: `req-${suffix}` };

  const callerAuth = (directory = createLlmIdentityDirectory()) => {
    const oauth = getSentropicOAuthPorts();
    const identity = createLlmCallerIdentity({
      directory,
      config: {
        issuer: ISSUER, resource: RESOURCE, source: 'llm-gateway', ownerMapping: [],
        serviceBindings: [{ clientId: CLIENT_ID, tenantId: TENANT, workspaceId: WORKSPACE }],
      },
    });
    const verifyToken = new ServiceAuthVerifyToken({
      auth: {
        issuer: ISSUER, resource: RESOURCE, requiredScopes: ['service:ping'],
        ports: { clock: oauth.clock, jwks: oauth.jwks, dpopReplay: { recordDpopJti: oauth.oauthStateStore.recordDpopJti } },
      },
      resolvePrincipal: (verified) => identity.resolveServicePrincipal(verified),
    });
    return new PersonalPassthroughCallerAuth({ verifyToken, costContextResolver: new VerifiedCostContextResolver() });
  };

  beforeEach(async () => {
    await ensureActiveSigningKey('test-s2s-kid');
    await seedServiceClient();
    await db.insert(tenants).values({ id: TENANT, name: TENANT, status: 'active' }).onConflictDoNothing();
    await db.insert(workspaces).values({ id: WORKSPACE, name: WORKSPACE, tenantId: TENANT }).onConflictDoNothing();
    await db.update(serviceClients).set({ tenantId: TENANT }).where(eq(serviceClients.clientId, CLIENT_ID));
  });

  afterEach(async () => {
    await db.delete(serviceClients).where(eq(serviceClients.clientId, CLIENT_ID));
    await db.delete(workspaces).where(eq(workspaces.id, WORKSPACE));
    await db.delete(tenants).where(eq(tenants.id, TENANT));
  });

  it('attributes a real IdP service token to the service principal of service_clients.tenant_id', async () => {
    const token = await mintToken('service:ping');
    const result = await callerAuth().verify({
      authorization: `Bearer ${token}`,
      // Forged attribution headers never override directory state or the server request id.
      'x-sentropic-tenant-id': 'forged-tenant', 'x-workspace-id': 'forged-ws', 'x-correlation-id': 'forged',
    }, context);
    expect(result).toEqual({
      ok: true,
      cost: {
        tenantId: TENANT, workspaceId: WORKSPACE, principalId: `service:${CLIENT_ID}`, source: 'llm-gateway',
        ownerScopeRef: `workspace:${WORKSPACE}:principal:service:${CLIENT_ID}`,
        correlationId: context.requestId, callSite: 'llm-gateway',
      },
    });
  });

  it('refuses an already-minted token once the client is revoked or loses its tenant', async () => {
    const token = await mintToken('service:ping');
    const auth = callerAuth();
    await db.update(serviceClients).set({ revokedAt: new Date() }).where(eq(serviceClients.clientId, CLIENT_ID));
    expect(await auth.verify({ authorization: `Bearer ${token}` }, context)).toMatchObject({ ok: false });
    await db.update(serviceClients).set({ revokedAt: null, tenantId: null }).where(eq(serviceClients.clientId, CLIENT_ID));
    expect(await auth.verify({ authorization: `Bearer ${token}` }, context)).toMatchObject({ ok: false });
  });

  it('refuses a wrong-audience or wrong-scope token before any directory lookup', async () => {
    await db
      .update(serviceClients)
      .set({ resourceIndicators: [RESOURCE, 'http://localhost:9197/other'] })
      .where(eq(serviceClients.clientId, CLIENT_ID));
    let lookups = 0;
    const directory = createLlmIdentityDirectory();
    const counted = { ...directory, findServiceClient: (id: string) => { lookups += 1; return directory.findServiceClient(id); } };
    for (const token of [await mintToken('service:ping', 'http://localhost:9197/other'), await mintToken('service:read')]) {
      expect(await callerAuth(counted).verify({ authorization: `Bearer ${token}` }, context)).toMatchObject({ ok: false });
    }
    expect(lookups).toBe(0);
  });

  it('fails closed as unavailable (never allowed) when the directory database is down', async () => {
    const token = await mintToken('service:ping');
    const down = createLlmIdentityDirectory({ select: () => { throw new Error('connection refused'); } } as never);
    await expect(callerAuth(down).verify({ authorization: `Bearer ${token}` }, context))
      .rejects.toMatchObject({ kind: 'caller-auth-unavailable' });
  });
});

const mintToken = async (scope: string, resource: string = RESOURCE): Promise<string> => {
  const response = await app.request(TOKEN_URL, {
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource,
      scope,
    }).toString(),
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
};

const seedServiceClient = async (): Promise<void> => {
  const now = new Date();
  const values = {
    allowedScopes: ['service:ping', 'service:read'],
    clientId: CLIENT_ID,
    clientSecretHash: createHash('sha256').update(CLIENT_SECRET).digest('hex'),
    createdAt: now,
    displayName: 'Test Service RP',
    dpopBoundAccessTokens: false,
    id: 'test-s2s-service-client',
    resourceIndicators: [RESOURCE],
    revokedAt: null,
  };
  await db
    .insert(serviceClients)
    .values(values)
    .onConflictDoUpdate({
      set: {
        allowedScopes: values.allowedScopes,
        clientSecretHash: values.clientSecretHash,
        resourceIndicators: values.resourceIndicators,
        revokedAt: null,
      },
      target: serviceClients.clientId,
    });
};

const ensureActiveSigningKey = async (kid: string) => {
  const jwks = createJwksAdapter();
  if (await jwks.getActiveKey()) return jwks;
  try {
    await jwks.generateAndStoreNewKey({ kid });
  } catch (error) {
    if (!String(error).includes('duplicate key value')) throw error;
  }
  return createJwksAdapter();
};
