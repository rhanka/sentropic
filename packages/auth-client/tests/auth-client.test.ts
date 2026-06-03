import { generateKeyPairSync, randomUUID } from 'node:crypto';

import {
  createOAuthRouter,
  createRequireServiceAuth,
  type JwksKeyRecord,
  type JwksPort,
  type OauthStateStorePort,
  type ServiceClientRecord,
} from '@sentropic/auth-hono';
import { Hono } from 'hono';
import { decodeProtectedHeader, decodeJwt, exportJWK } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthClient, type FetchLike } from '../src/index.js';

const issuer = 'http://localhost:9197';
const resource = 'http://localhost:9197';
const tokenEndpoint = `${issuer}/api/v1/auth/oauth/token`;

const clock = {
  addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
  now: () => new Date(),
};

const createJwksPort = async (): Promise<JwksPort> => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicJwk = await exportJWK(publicKey);
  const key: JwksKeyRecord = {
    active: true,
    alg: 'EdDSA',
    createdAt: new Date(),
    crv: 'Ed25519',
    kid: 'kid-1',
    privateKey,
    publicJwk: { ...publicJwk, alg: 'EdDSA', kid: 'kid-1', use: 'sig' },
    rotatedAt: null,
  };
  return {
    async findKeyByKid(kid) {
      return kid === key.kid ? key : null;
    },
    async getActiveKey() {
      return key;
    },
    async listPublicKeys() {
      return [key];
    },
  };
};

const createServiceStore = (client: ServiceClientRecord): OauthStateStorePort => {
  const dpopJtis = new Set<string>();
  const unsupported = async (): Promise<never> => {
    throw new Error('not used by client_credentials');
  };
  return {
    consumeAuthCode: unsupported,
    findClient: async () => null,
    findServiceClient: async (clientId) => (clientId === client.clientId && !client.revokedAt ? client : null),
    findTokenMeta: async () => null,
    isTokenRevoked: async () => false,
    purgeExpired: async () => 0,
    async recordDpopJti(jti) {
      if (dpopJtis.has(jti)) return false;
      dpopJtis.add(jti);
      return true;
    },
    revokeToken: async () => true,
    saveAuthCode: unsupported,
    saveTokenMeta: unsupported,
  };
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

interface Harness {
  app: Hono;
  fetch: FetchLike;
  store: OauthStateStorePort;
}

const buildHarness = async (client: ServiceClientRecord): Promise<Harness> => {
  const jwks = await createJwksPort();
  const store = createServiceStore(client);
  const ports = {
    clock,
    jwks,
    oauthStateStore: store,
    random: {
      bytes: (length: number) => new Uint8Array(length).fill(1),
      numericCode: (length: number) => '1'.repeat(length),
      token: () => randomUUID(),
      uuid: () => randomUUID(),
    },
    tokens: {
      hashSecret: (secret: string) => sha256(secret),
      signSessionToken: async () => 'session-token',
      signVerificationToken: async () => 'verification-token',
      verifySessionToken: async () => null,
    },
  } as unknown as Parameters<typeof createOAuthRouter>[0]['ports'];

  const app = new Hono();
  app.route(
    '/api/v1/auth/oauth',
    createOAuthRouter({
      consentUrl: `${issuer}/consent`,
      issuer,
      loginUrl: `${issuer}/login`,
      ports,
      routePrefix: '',
    })
  );
  app.get(
    '/internal/ping',
    createRequireServiceAuth({
      issuer,
      ports: { clock, dpopReplay: store, jwks },
      requiredScopes: ['service:ping'],
      resource,
    }),
    (c) => c.json({ ok: true })
  );

  const fetchImpl: FetchLike = async (input, init) => app.request(input, init);

  return { app, fetch: fetchImpl, store };
};

const baseClient: ServiceClientRecord = {
  allowedScopes: ['service:ping', 'service:read'],
  clientId: 'service-rp',
  clientSecretHash: 'sha-placeholder',
  createdAt: new Date(),
  displayName: 'Service RP',
  dpopBoundAccessTokens: false,
  id: 'service-row-1',
  resourceIndicators: [resource],
  revokedAt: null,
  secretRotatedAt: null,
  tenantId: null,
};

const withSecret = async (overrides: Partial<ServiceClientRecord> = {}): Promise<ServiceClientRecord> => ({
  ...baseClient,
  clientSecretHash: await sha256('service-secret'),
  ...overrides,
});

describe('createAuthClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a token and reuses it from cache', async () => {
    const harness = await buildHarness(await withSecret());
    const spy = vi.spyOn(harness, 'fetch');
    const client = createAuthClient({
      clientId: 'service-rp',
      clientSecret: 'service-secret',
      fetch: spy as unknown as FetchLike,
      issuer,
      resource,
      scope: 'service:ping',
    });

    const first = await client.getToken();
    const second = await client.getToken();

    expect(first.token_type).toBe('Bearer');
    expect(first.access_token).toBe(second.access_token);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(decodeJwt(first.access_token)).toMatchObject({ aud: resource, scope: 'service:ping' });
  });

  it('refreshes the token when the cached one is within the refresh skew', async () => {
    const harness = await buildHarness(await withSecret());
    const spy = vi.spyOn(harness, 'fetch');
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const client = createAuthClient({
      clientId: 'service-rp',
      clientSecret: 'service-secret',
      fetch: spy as unknown as FetchLike,
      issuer,
      now: () => new Date(nowMs),
      refreshSkewSeconds: 30,
      resource,
      scope: 'service:ping',
    });

    await client.getToken();
    nowMs += 900 * 1000; // jump past the TTL
    await client.getToken();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('forwards scope and resource to the token endpoint', async () => {
    const harness = await buildHarness(
      await withSecret({ resourceIndicators: [resource, 'http://localhost:9197/other'] })
    );
    const spy = vi.spyOn(harness, 'fetch');
    const client = createAuthClient({
      clientId: 'service-rp',
      clientSecret: 'service-secret',
      fetch: spy as unknown as FetchLike,
      issuer,
    });

    const token = await client.getToken({ resource: 'http://localhost:9197/other', scope: ['service:read'] });

    const body = String((spy.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('scope=service%3Aread');
    expect(body).toContain('resource=http%3A%2F%2Flocalhost%3A9197%2Fother');
    expect(decodeJwt(token.access_token)).toMatchObject({ aud: 'http://localhost:9197/other' });
  });

  it('sends a DPoP proof of the correct shape when dpop is enabled', async () => {
    const harness = await buildHarness(await withSecret({ dpopBoundAccessTokens: true }));
    const spy = vi.spyOn(harness, 'fetch');
    const client = createAuthClient({
      clientId: 'service-rp',
      clientSecret: 'service-secret',
      dpop: true,
      fetch: spy as unknown as FetchLike,
      issuer,
      resource,
      scope: 'service:ping',
    });

    const token = await client.getToken();

    const proof = (spy.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers.dpop;
    expect(proof).toBeTruthy();
    expect(decodeProtectedHeader(proof)).toMatchObject({ alg: 'EdDSA', typ: 'dpop+jwt' });
    expect(decodeJwt(proof)).toMatchObject({ htm: 'POST', htu: tokenEndpoint });
    expect(token.token_type).toBe('DPoP');
    expect(decodeJwt(token.access_token)).toHaveProperty('cnf');
  });

  it('completes a real mint -> call round-trip against a protected route (Bearer)', async () => {
    const harness = await buildHarness(await withSecret());
    const client = createAuthClient({
      clientId: 'service-rp',
      clientSecret: 'service-secret',
      fetch: harness.fetch,
      issuer,
      resource,
      scope: 'service:ping',
    });

    const token = await client.getToken();
    const response = await harness.app.request('/internal/ping', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('completes a DPoP-bound mint -> call round-trip with ath binding', async () => {
    const harness = await buildHarness(await withSecret({ dpopBoundAccessTokens: true }));
    const client = createAuthClient({
      clientId: 'service-rp',
      clientSecret: 'service-secret',
      dpop: true,
      fetch: harness.fetch,
      issuer,
      resource,
      scope: 'service:ping',
    });

    const token = await client.getToken();
    const proof = await client.buildDpopProof({
      accessToken: token.access_token,
      htm: 'GET',
      htu: 'http://localhost/internal/ping',
    });
    const response = await harness.app.request('/internal/ping', {
      headers: { authorization: `DPoP ${token.access_token}`, dpop: proof },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('throws AuthClientError with the OAuth error code on bad credentials', async () => {
    const harness = await buildHarness(await withSecret());
    const client = createAuthClient({
      clientId: 'service-rp',
      clientSecret: 'wrong-secret',
      fetch: harness.fetch,
      issuer,
      resource,
      scope: 'service:ping',
    });

    await expect(client.getToken()).rejects.toMatchObject({ code: 'invalid_client', status: 401 });
  });
});
