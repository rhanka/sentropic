import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { app } from '../../../src/app';
import { db } from '../../../src/db/client';
import { serviceClients } from '../../../src/db/schema';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';

const ISSUER = 'http://localhost:9197';
const RESOURCE = ISSUER;
const CLIENT_ID = 'test-service-rp';
const CLIENT_SECRET = 'test-service-rp-secret-dev-only';
const PING_URL = `${ISSUER}/api/v1/auth/s2s/ping`;
const TOKEN_URL = `${ISSUER}/api/v1/auth/oauth/token`;

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
