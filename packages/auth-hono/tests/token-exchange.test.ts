import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  TOKEN_EXCHANGE_GRANT_TYPE,
  TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE,
} from '../src/oauth/state-store-types.js';
import { createOauthPorts, createOauthRouterForTest, oauthUser } from './__fixtures__/oauth-fixtures.js';
import {
  ISSUER,
  RADAR_AUDIENCE,
  basicAuth,
  mintSubject,
  publicImmoClient,
  workloadClient,
} from './__fixtures__/token-exchange-fixtures.js';

describe('OAuth token exchange', () => {
  it('exchanges a valid subject for a scoped token with the mandatory act claim', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const subject = await mintSubject(ports, store, {});

    const response = await exchangeRequest(router, { scope: 'immo:search', subject });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_type).toBe('Bearer');
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(body.scope).toBe('immo:search');
    expect(body.expires_in).toBeLessThanOrEqual(300);
    const claims = decodeJwt(body.access_token as string) as Record<string, unknown>;
    expect(claims).toMatchObject({
      act: { sub: 'immo-mcp-workload' },
      aud: RADAR_AUDIENCE,
      client_id: 'immo-mcp-workload',
      iss: ISSUER,
      scope: 'immo:search',
      sub: oauthUser.id,
    });
    expect(body).not.toHaveProperty('refresh_token');
    expect(body).not.toHaveProperty('id_token');
  });

  it('intersects requested scopes with subject scopes and policy', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const subject = await mintSubject(ports, store, { scope: 'immo:read immo:search' });

    const response = await exchangeRequest(router, { scope: 'immo:read', subject });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { scope: string }).scope).toBe('immo:read');
  });

  it('caps expiry at the subject expiry when it is sooner than 300 seconds', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const subject = await mintSubject(ports, store, { subjectTtlSeconds: 120 });
    const subjectExp = (decodeJwt(subject) as { exp: number }).exp;

    const response = await exchangeRequest(router, { scope: 'immo:search', subject });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    expect(body.expires_in).toBeLessThanOrEqual(120);
    expect((decodeJwt(body.access_token) as { exp: number }).exp).toBeLessThanOrEqual(subjectExp);
  });

  it('rejects client_credentials for the exchange-only workload client', async () => {
    const { ports } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request('/oauth/token', {
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'immo:search',
      }).toString(),
      headers: {
        authorization: basicAuth('immo-mcp-workload', 'workload-secret'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });
    expect(response.status).toBe(400);
  });
});

const exchangeRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: { scope: string; subject: string; authorization?: string }
) =>
  router.request('/oauth/token', {
    body: new URLSearchParams({
      audience: RADAR_AUDIENCE,
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      scope: input.scope,
      subject_token: input.subject,
      subject_token_type: TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE,
    }).toString(),
    headers: {
      authorization: input.authorization ?? basicAuth('immo-mcp-workload', 'workload-secret'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
