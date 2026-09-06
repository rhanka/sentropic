import { createHash } from 'node:crypto';

import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { app } from '../../../src/app';
import { env } from '../../../src/config/env';
import { db } from '../../../src/db/client';
import { connectorTenantEnrollments } from '../../../src/db/control-schema';
import { serviceClients, tenants } from '../../../src/db/schema';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';

// ARCH-11 G1c — S2S OBO mint end-to-end via the real token endpoint (spec §2.2). Proves the
// DEFAULT (shadow) path is byte-identical (NO tid even with a `tenant=` param), and that strict
// mode validates the requested tenant fail-closed against the client's authorized set — including
// a NON-VACUOUS ≥2-org case (fixed org-A + enrolled org-B; org-C denied).

const ISSUER = 'http://localhost:9197';
const RESOURCE = ISSUER;
const TOKEN_URL = `${ISSUER}/api/v1/oauth/token`;

const SINGLE_CLIENT_ID = 'arch11g1c-obo-single';
const SINGLE_SECRET = 'arch11g1c-obo-single-secret-dev-only';
const MULTI_CLIENT_ID = 'arch11g1c-obo-multi';
const MULTI_SECRET = 'arch11g1c-obo-multi-secret-dev-only';
const TEST_CLIENTS = [SINGLE_CLIENT_ID, MULTI_CLIENT_ID];

const ORG_A = 'arch11g1c-obo-org-a';
const ORG_B = 'arch11g1c-obo-org-b';
const ORG_C = 'arch11g1c-obo-org-c';
const TEST_ORGS = [ORG_A, ORG_B, ORG_C];
const CONNECTOR = 'arch11g1c-obo-connector';

const originalMode = env.TENANT_RESOLUTION_MODE;

const seedServiceClient = async (clientId: string, secret: string, tenantId: string): Promise<void> => {
  const now = new Date();
  await db
    .insert(serviceClients)
    .values({
      id: `svc-${clientId}`,
      clientId,
      clientSecretHash: createHash('sha256').update(secret).digest('hex'),
      displayName: clientId,
      allowedScopes: ['service:ping'],
      resourceIndicators: [RESOURCE],
      dpopBoundAccessTokens: false,
      tenantId,
      createdAt: now,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      set: { clientSecretHash: createHash('sha256').update(secret).digest('hex'), tenantId, revokedAt: null },
      target: serviceClients.clientId,
    });
};

const ensureActiveSigningKey = async (): Promise<void> => {
  const jwks = createJwksAdapter();
  if (await jwks.getActiveKey()) return;
  try {
    await jwks.generateAndStoreNewKey({ kid: 'arch11g1c-obo-kid' });
  } catch (error) {
    if (!String(error).includes('duplicate key value')) throw error;
  }
};

const mint = async (
  clientId: string,
  secret: string,
  params: Record<string, string> = {}
): Promise<Response> =>
  app.request(TOKEN_URL, {
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'service:ping', resource: RESOURCE, ...params }).toString(),
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

const tidOf = async (response: Response): Promise<unknown> => {
  const body = (await response.json()) as { access_token: string };
  return (decodeJwt(body.access_token) as Record<string, unknown>).tid;
};

describe('ARCH-11 G1c — S2S OBO mint (token endpoint)', () => {
  beforeEach(async () => {
    await ensureActiveSigningKey();
    for (const org of TEST_ORGS) {
      await db.insert(tenants).values({ id: org, name: org, status: 'active' }).onConflictDoNothing();
    }
    await seedServiceClient(SINGLE_CLIENT_ID, SINGLE_SECRET, ORG_A);
    await seedServiceClient(MULTI_CLIENT_ID, MULTI_SECRET, ORG_A);
    await db
      .insert(connectorTenantEnrollments)
      .values({ principalSub: MULTI_CLIENT_ID, connectorInstanceId: CONNECTOR, tenantId: ORG_B, status: 'active' })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    env.TENANT_RESOLUTION_MODE = originalMode;
    await db.delete(connectorTenantEnrollments).where(inArray(connectorTenantEnrollments.principalSub, TEST_CLIENTS));
    await db.delete(serviceClients).where(inArray(serviceClients.clientId, TEST_CLIENTS));
    await db.delete(tenants).where(inArray(tenants.id, TEST_ORGS));
  });

  it('DEFAULT (shadow): mint carries NO tid even with a `tenant=` param (byte-identical)', async () => {
    env.TENANT_RESOLUTION_MODE = 'shadow';
    const response = await mint(SINGLE_CLIENT_ID, SINGLE_SECRET, { tenant: ORG_A });
    expect(response.status).toBe(200);
    expect(await tidOf(response)).toBeUndefined();
  });

  it('strict single-org: an omitted tenant binds the fixed tenant → tid = fixed', async () => {
    env.TENANT_RESOLUTION_MODE = 'strict';
    const response = await mint(SINGLE_CLIENT_ID, SINGLE_SECRET);
    expect(response.status).toBe(200);
    expect(await tidOf(response)).toBe(ORG_A);
  });

  it('strict single-org: a wrong supplied tenant is rejected invalid_target', async () => {
    env.TENANT_RESOLUTION_MODE = 'strict';
    const response = await mint(SINGLE_CLIENT_ID, SINGLE_SECRET, { tenant: ORG_B });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid_target');
  });

  it('strict multi-org (NON-VACUOUS ≥2-org): tenant selects the authorized org; out-of-set + absent fail closed', async () => {
    env.TENANT_RESOLUTION_MODE = 'strict';

    // fixed org-A → authorized.
    expect(await tidOf(await mint(MULTI_CLIENT_ID, MULTI_SECRET, { tenant: ORG_A }))).toBe(ORG_A);
    // enrolled org-B → authorized.
    expect(await tidOf(await mint(MULTI_CLIENT_ID, MULTI_SECRET, { tenant: ORG_B }))).toBe(ORG_B);
    // org-C never enrolled → denied.
    const denied = await mint(MULTI_CLIENT_ID, MULTI_SECRET, { tenant: ORG_C });
    expect(denied.status).toBe(400);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('invalid_target');
    // multi-org with NO tenant selector → mandatory, fail closed.
    const absent = await mint(MULTI_CLIENT_ID, MULTI_SECRET);
    expect(absent.status).toBe(400);
    expect(((await absent.json()) as { error: { code: string } }).error.code).toBe('invalid_target');
  });
});
