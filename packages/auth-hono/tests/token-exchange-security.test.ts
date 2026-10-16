import { describe, expect, it } from 'vitest';

import { createJwksService } from '../src/oauth/jwks-service.js';
import {
  TOKEN_EXCHANGE_GRANT_TYPE,
  TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE,
} from '../src/oauth/state-store-types.js';
import {
  createOauthPorts,
  createOauthRouterForTest,
  createServiceClient,
  oauthNow,
  oauthUser,
} from './__fixtures__/oauth-fixtures.js';
import {
  MCP_AUDIENCE,
  RADAR_AUDIENCE,
  basicAuth,
  mintSubject,
  publicImmoClient,
  workloadClient,
} from './__fixtures__/token-exchange-fixtures.js';

const setup = async (serviceClients = [workloadClient()], clients = [publicImmoClient()]) => {
  const { ports, store } = await createOauthPorts({ clients, serviceClients });
  const { router } = createOauthRouterForTest({ ports });
  const subject = await mintSubject(ports, store, {});
  return { ports, router, store, subject };
};

describe('OAuth token exchange security', () => {
  it('rejects a wrong subject_token_type', async () => {
    const { router, subject } = await setup();
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject,
      subjectType: 'urn:ietf:params:oauth:token-type:id_token',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('rejects an unsupported requested_token_type', async () => {
    const { router, subject } = await setup();
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      requestedType: 'urn:ietf:params:oauth:token-type:refresh_token',
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('rejects actor_token delegation forms', async () => {
    const { router, subject } = await setup();
    const form = baseForm(subject);
    form.set('actor_token', 'forged');
    form.set('actor_token_type', TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE);
    const response = await postForm(router, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('rejects DPoP-bound exchange attempts', async () => {
    const { router, subject } = await setup();
    const response = await router.request('/oauth/token', {
      body: baseForm(subject).toString(),
      headers: {
        authorization: basicAuth('immo-mcp-workload', 'workload-secret'),
        'content-type': 'application/x-www-form-urlencoded',
        dpop: 'proof',
      },
      method: 'POST',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('rejects conflicting target audiences', async () => {
    const { router, subject } = await setup();
    const form = baseForm(subject);
    form.append('audience', 'https://other.example/audience');
    const response = await postForm(router, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_target' } });
  });

  it('rejects a missing target audience', async () => {
    const { router, subject } = await setup();
    const form = baseForm(subject);
    form.delete('audience');
    const response = await postForm(router, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_target' } });
  });

  it('rejects a target audience outside the policy', async () => {
    const { router, subject } = await setup();
    const response = await postExchange(router, {
      audience: 'https://evil.example/api',
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_target' } });
  });

  it('rejects an empty scope', async () => {
    const { router, subject } = await setup();
    const form = baseForm(subject);
    form.delete('scope');
    const response = await postForm(router, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_scope' } });
  });

  it('rejects a scope outside the workload policy', async () => {
    const { router, subject } = await setup();
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'admin:write',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_scope' } });
  });

  it('rejects a scope the subject was never granted', async () => {
    const { ports, store } = await (async () => {
      const created = await createOauthPorts({
        clients: [publicImmoClient()],
        serviceClients: [workloadClient()],
      });
      return created;
    })();
    const { router } = createOauthRouterForTest({ ports });
    const narrow = await mintSubject(ports, store, { scope: 'immo:read' });
    const form = baseForm(narrow);
    form.set('scope', 'immo:search');
    const response = await postForm(router, form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_scope' } });
  });

  it('rejects the public client as the requesting client', async () => {
    const { router, subject } = await setup();
    // M5: a non-empty secret reaches the public-client branch instead of
    // stopping at generic authentication-required.
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      authorization: basicAuth('immo-mcp', 'not-a-secret'),
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_client' } });
  });

  it('rejects a wrong workload secret', async () => {
    const { router, subject } = await setup();
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      authorization: basicAuth('immo-mcp-workload', 'wrong-secret'),
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_client' } });
  });

  it('rejects an unrelated service client without exchange policy', async () => {
    const other = createServiceClient({ clientId: 'other-svc', clientSecretHash: 'hash:other' });
    const { router, subject } = await setup([workloadClient(), other]);
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      authorization: basicAuth('other-svc', 'other'),
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unauthorized_client' } });
  });

  it('rejects a disabled exchange policy', async () => {
    const { router, subject } = await setup([workloadClient({ enabled: false })]);
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unauthorized_client' } });
  });

  it('rejects a subject with the wrong audience', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const subject = await mintRawSubject(ports, store, { audience: 'https://immo.sent-tech.ca' });
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_grant' } });
  });

  it('rejects a subject from a non-allowed originating client', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const subject = await mintRawSubject(ports, store, { clientId: 'some-other-client' });
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_grant' } });
  });

  it('rejects an already-exchanged subject carrying act', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const subject = await mintRawSubject(ports, store, { extra: { act: { sub: 'immo-mcp-workload' } } });
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_grant' } });
  });

  it('rejects a proof-bound subject carrying cnf', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const subject = await mintRawSubject(ports, store, { extra: { cnf: { jkt: 'thumbprint' } } });
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_grant' } });
  });

  it('rejects a revoked subject token', async () => {
    const { ports, router, store, subject } = await setup();
    const jti = store.tokens.keys().next().value as string;
    await store.revokeToken(jti);
    void ports;
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_grant' } });
  });

  it('rejects an unknown subject with no stored metadata', async () => {
    const { ports, store } = await createOauthPorts({
      clients: [publicImmoClient()],
      serviceClients: [workloadClient()],
    });
    const { router } = createOauthRouterForTest({ ports });
    const jwks = createJwksService({ clock: ports.clock, jwksPort: ports.jwks });
    const orphan = await jwks.signJwt(
      { client_id: 'immo-mcp', scope: 'immo:search' },
      {
        audience: MCP_AUDIENCE,
        expiresAt: new Date(oauthNow.getTime() + 3600 * 1000),
        issuer: 'http://localhost:9197',
        jti: 'orphan-jti',
        subject: oauthUser.id,
        type: 'JWT',
      }
    );
    void store;
    const response = await postExchange(router, {
      audience: RADAR_AUDIENCE,
      scope: 'immo:search',
      subject: orphan,
    });
    expect(response.status).toBe(400);
  });
});

const baseForm = (subject: string): URLSearchParams =>
  new URLSearchParams({
    audience: RADAR_AUDIENCE,
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    scope: 'immo:search',
    subject_token: subject,
    subject_token_type: TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE,
  });

const postForm = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  form: URLSearchParams,
  authorization = basicAuth('immo-mcp-workload', 'workload-secret')
) =>
  router.request('/oauth/token', {
    body: form.toString(),
    headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

const postExchange = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  input: {
    audience: string;
    authorization?: string;
    requestedType?: string;
    scope: string;
    subject: string;
    subjectType?: string;
  }
) => {
  const form = new URLSearchParams({
    audience: input.audience,
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    scope: input.scope,
    subject_token: input.subject,
    subject_token_type: input.subjectType ?? TOKEN_EXCHANGE_SUBJECT_TOKEN_TYPE,
  });
  if (input.requestedType) form.set('requested_token_type', input.requestedType);
  return postForm(router, form, input.authorization);
};

const mintRawSubject = async (
  ports: Awaited<ReturnType<typeof createOauthPorts>>['ports'],
  store: Awaited<ReturnType<typeof createOauthPorts>>['store'],
  input: { audience?: string; clientId?: string; extra?: Record<string, unknown> } = {}
): Promise<string> => {
  const jwks = createJwksService({ clock: ports.clock, jwksPort: ports.jwks });
  const jti = `raw-${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(oauthNow.getTime() + 3600 * 1000);
  const token = await jwks.signJwt(
    { client_id: input.clientId ?? 'immo-mcp', scope: 'immo:search', ...(input.extra ?? {}) },
    {
      audience: input.audience ?? MCP_AUDIENCE,
      expiresAt,
      issuer: 'http://localhost:9197',
      jti,
      subject: oauthUser.id,
      type: 'JWT',
    }
  );
  await store.saveTokenMeta(
    jti,
    {
      audience: input.audience ?? MCP_AUDIENCE,
      clientId: input.clientId ?? 'immo-mcp',
      createdAt: oauthNow,
      dpopJkt: null,
      expiresAt,
      jti,
      scope: 'immo:search',
      tenantId: null,
      tokenType: 'access_token',
      userId: oauthUser.id,
    },
    3600
  );
  return token;
};
