import { calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  createOauthPorts,
  createOauthRouterForTest,
  createServiceClient,
  oauthNow,
} from './__fixtures__/oauth-fixtures.js';

const resource = 'https://api.sentropic.test';

describe('OAuth client_credentials grant (stateless service tokens)', () => {
  it('issues a Bearer access token via client_secret_basic', async () => {
    const { ports, store } = await createOauthPorts({ serviceClients: [createServiceClient()] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, { scope: 'service:ping' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
      scope: string;
      token_type: string;
    };
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(900);
    expect(body.scope).toBe('service:ping');
    expect(decodeJwt(body.access_token)).toMatchObject({
      aud: resource,
      client_id: 'service-rp',
      scope: 'service:ping',
      sub: 'service-rp',
    });
    expect(decodeJwt(body.access_token)).not.toHaveProperty('id_token');
    expect(store.tokens.size).toBe(0);
  });

  it('issues a token via client_secret_post body credentials', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [createServiceClient()] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request('/oauth/token', {
      body: formBody({
        client_id: 'service-rp',
        client_secret: 'service-secret',
        grant_type: 'client_credentials',
        resource,
        scope: 'service:ping',
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as { token_type: string }).toMatchObject({ token_type: 'Bearer' });
  });

  it('grants all allowed scopes when scope is absent', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [createServiceClient()] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, {});

    expect(response.status).toBe(200);
    expect((await response.json()) as { scope: string }).toMatchObject({
      scope: 'service:ping service:read',
    });
  });

  it('issues a DPoP-bound token with cnf.jkt and token_type DPoP', async () => {
    const dpopClient = createServiceClient({ dpopBoundAccessTokens: true });
    const { ports } = await createOauthPorts({ serviceClients: [dpopClient] });
    const { router } = createOauthRouterForTest({ ports });
    const proofKey = await generateKeyPair('EdDSA');
    const proof = await createDpopProof({
      htm: 'POST',
      htu: 'http://localhost/oauth/token',
      jti: 'service-proof-1',
      keyPair: proofKey,
    });

    const response = await tokenRequest(router, { dpop: proof, scope: 'service:ping' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; token_type: string };
    const jkt = await calculateJwkThumbprint(await exportJWK(proofKey.publicKey));
    expect(body.token_type).toBe('DPoP');
    expect(decodeJwt(body.access_token)).toMatchObject({ cnf: { jkt } });
  });

  it('rejects a wrong client secret with invalid_client', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [createServiceClient()] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, {
      authorization: basicAuth('service-rp', 'wrong-secret'),
      scope: 'service:ping',
    });

    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'invalid_client' } });
  });

  it('rejects scopes outside allowed_scopes with invalid_scope', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [createServiceClient()] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, { scope: 'service:ping service:admin' });

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'invalid_scope' } });
  });

  it('rejects a revoked service client with invalid_client', async () => {
    const revoked = createServiceClient({ revokedAt: oauthNow });
    const { ports } = await createOauthPorts({ serviceClients: [revoked] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, { scope: 'service:ping' });

    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'invalid_client' } });
  });

  it('rejects an unknown resource with invalid_target', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [createServiceClient()] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, {
      resource: 'https://evil.example.test',
      scope: 'service:ping',
    });

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'invalid_target' } });
  });

  it('requires resource when the client has multiple indicators (invalid_target)', async () => {
    const multi = createServiceClient({
      resourceIndicators: ['https://api.sentropic.test', 'https://immo.sentropic.test'],
    });
    const { ports } = await createOauthPorts({ serviceClients: [multi] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, { resource: undefined, scope: 'service:ping' });

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'invalid_target' } });
  });

  it('requires resource when the client has zero indicators (invalid_target)', async () => {
    const none = createServiceClient({ resourceIndicators: [] });
    const { ports } = await createOauthPorts({ serviceClients: [none] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, { resource: undefined, scope: 'service:ping' });

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'invalid_target' } });
  });

  it('returns unsupported_grant_type when findServiceClient is unavailable', async () => {
    const { ports } = await createOauthPorts();
    delete (ports.oauthStateStore as { findServiceClient?: unknown }).findServiceClient;
    const { router } = createOauthRouterForTest({ ports });

    const response = await tokenRequest(router, { scope: 'service:ping' });

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'unsupported_grant_type' } });
  });
});

const tokenRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: Record<string, string | undefined> & { authorization?: string; dpop?: string }
) =>
  router.request('/oauth/token', {
    body: formBody({
      grant_type: 'client_credentials',
      resource,
      ...input,
    }),
    headers: {
      authorization: input.authorization ?? basicAuth('service-rp', 'service-secret'),
      ...(input.dpop ? { dpop: input.dpop } : {}),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

const createDpopProof = async (input: {
  htm: string;
  htu: string;
  jti: string;
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
}): Promise<string> =>
  new SignJWT({
    htm: input.htm,
    htu: input.htu,
    iat: Math.floor(oauthNow.getTime() / 1000),
    jti: input.jti,
  })
    .setProtectedHeader({
      alg: 'EdDSA',
      jwk: await exportJWK(input.keyPair.publicKey),
      typ: 'dpop+jwt',
    })
    .sign(input.keyPair.privateKey);

const basicAuth = (clientId: string, secret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`;

const formBody = (input: Record<string, string | undefined>): string => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && key !== 'authorization' && key !== 'dpop') form.set(key, value);
  }
  return form.toString();
};
