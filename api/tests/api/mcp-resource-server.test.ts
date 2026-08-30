import { createJwksService } from '@sentropic/auth-hono';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import { GMAIL_PROVIDER } from '../../src/services/gmail-oauth';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import { createJwksAdapter, type JwksAdapter } from '../../src/services/auth/jwks-adapter';
import { cleanupAuthData, createTestUser, type TestUser } from '../utils/auth-helper';
import { encryptSecret } from '../../src/services/secret-crypto';

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const ensureActiveSigningKey = async (): Promise<JwksAdapter> => {
  const jwks = createJwksAdapter();
  if (await jwks.getActiveKey()) return jwks;
  try {
    await jwks.generateAndStoreNewKey({ kid: 'mcp-resource-server-test-kid' });
  } catch (error) {
    if (!String(error).includes('duplicate key value')) throw error;
  }
  return createJwksAdapter();
};

// BR-39l Lot 3 — first real consumption of @sentropic/mcp-auth (activation-by-consumption).
// These integration tests exercise the unauthenticated surface of the sample MCP resource
// server: the default-OFF gate, the RFC 9728 PRM document, and the 401 + resource_metadata
// pointer challenge a client gets without a token. The authenticated round-trip activates
// once @sentropic/oauth-verify's verify primitives land (Lot 1).

describe('MCP resource server (BR-39l Lot 3)', () => {
  const original = process.env.MCP_RESOURCE_SERVER_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.MCP_RESOURCE_SERVER_ENABLED;
    else process.env.MCP_RESOURCE_SERVER_ENABLED = original;
  });

  describe('when disabled (default)', () => {
    beforeEach(() => {
      delete process.env.MCP_RESOURCE_SERVER_ENABLED;
    });

    it('returns 404 for the PRM well-known', async () => {
      const res = await app.request('/api/v1/mcp/.well-known/oauth-protected-resource');
      expect(res.status).toBe(404);
    });

    it('returns 404 for the guarded invoke endpoint', async () => {
      const res = await app.request('/api/v1/mcp/invoke', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('when enabled', () => {
    beforeEach(() => {
      process.env.MCP_RESOURCE_SERVER_ENABLED = 'true';
    });

    it('serves the RFC 9728 Protected Resource Metadata document', async () => {
      const res = await app.request('/api/v1/mcp/.well-known/oauth-protected-resource');
      expect(res.status).toBe(200);
      const doc = await res.json();
      expect(typeof doc.resource).toBe('string');
      expect(Array.isArray(doc.authorization_servers)).toBe(true);
      expect(doc.authorization_servers.length).toBeGreaterThan(0);
      expect(doc.bearer_methods_supported).toEqual(['header']);
      expect(doc.scopes_supported).toContain('mcp:tools:invoke');
    });

    it('challenges an unauthenticated request with 401 + a PRM pointer', async () => {
      const res = await app.request('/api/v1/mcp/invoke', { method: 'POST' });
      expect(res.status).toBe(401);
      const www = res.headers.get('WWW-Authenticate');
      expect(www).toBeTruthy();
      expect(www).toContain('error="invalid_token"');
      expect(www).toContain('resource_metadata=');
      expect(www).toContain('/.well-known/oauth-protected-resource');
    });

    it('challenges a malformed Authorization header with 401', async () => {
      const res = await app.request('/api/v1/mcp/invoke', {
        method: 'POST',
        headers: { authorization: 'Bearer' },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    });
  });
});

describe('MCP connector-host routes', () => {
  const originalEnabled = process.env.MCP_RESOURCE_SERVER_ENABLED;
  let issuer: string;
  let resource: string;
  let user: TestUser;
  let jwks: JwksAdapter;
  let gmailAccessToken: string;

  beforeEach(async () => {
    process.env.MCP_RESOURCE_SERVER_ENABLED = 'true';
    const metadata = await app.request('/api/v1/mcp/.well-known/oauth-protected-resource');
    const document = await metadata.json() as { authorization_servers: string[]; resource: string };
    issuer = document.authorization_servers[0]!;
    resource = document.resource;
    jwks = await ensureActiveSigningKey();
    user = await createTestUser({ role: 'editor' });
    gmailAccessToken = `gmail-route-token-${crypto.randomUUID()}`;
    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      provider: GMAIL_PROVIDER,
      identity: { accountEmail: 'mcp-gmail@example.test', accountSubject: `gmail-${user.id}` },
      token: {
        accessToken: gmailAccessToken,
        refreshToken: 'gmail-route-refresh-token',
        idToken: null,
        tokenType: 'Bearer',
        scope: GMAIL_READONLY_SCOPE,
        scopes: [GMAIL_READONLY_SCOPE],
        obtainedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (user) {
      await db.delete(documentConnectorAccounts).where(and(
        eq(documentConnectorAccounts.userId, user.id),
        eq(documentConnectorAccounts.provider, GMAIL_PROVIDER),
      ));
    }
    await cleanupAuthData();
    if (originalEnabled === undefined) delete process.env.MCP_RESOURCE_SERVER_ENABLED;
    else process.env.MCP_RESOURCE_SERVER_ENABLED = originalEnabled;
  });

  const issueToken = async (scopes: string[]): Promise<string> => {
    const now = new Date();
    return createJwksService({
      clock: { now: () => now, addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000) },
      jwksPort: jwks,
    }).signJwt(
      { client_id: 'mcp-route-test-client', scope: scopes.join(' ') },
      {
        audience: resource,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        issuer,
        jti: crypto.randomUUID(),
        subject: user.id,
        type: 'JWT',
      },
    );
  };

  const installFetch = async (gmailResponse = new Response(JSON.stringify({ messages: [] }), { status: 200 })) => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/')) return gmailResponse;
      throw new Error(`Unexpected network request: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const invoke = (token: string, body: Record<string, unknown>) => app.request('/api/v1/mcp/invoke', {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    method: 'POST',
  });

  const readResource = (token: string, body: Record<string, unknown>) => app.request('/api/v1/mcp/resources/read', {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    method: 'POST',
  });

  const replaceGmailSecret = (tokenSecret: string) => db
    .update(documentConnectorAccounts)
    .set({ tokenSecret, updatedAt: new Date() })
    .where(and(eq(documentConnectorAccounts.userId, user.id), eq(documentConnectorAccounts.provider, GMAIL_PROVIDER)));

  it('invokes Gmail messages.list end-to-end without exposing the connector token', async () => {
    const fetchMock = await installFetch(new Response(JSON.stringify({ messages: [{ id: 'message-1' }] }), { status: 200 }));
    const token = await issueToken(['mcp:tools:invoke']);

    const response = await invoke(token, { connectorId: 'gmail', capabilityRef: 'messages.list', input: {} });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, output: { messages: [{ id: 'message-1' }] } });
    const googleCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://gmail.googleapis.com/'));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://gmail.googleapis.com/'))).toHaveLength(1);
    expect((googleCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${gmailAccessToken}` });
    expect(JSON.stringify(body)).not.toContain(gmailAccessToken);
  });

  it('rejects a token missing mcp:tools:invoke before the connector mount reaches Google', async () => {
    const fetchMock = await installFetch();
    const token = await issueToken(['mcp:resources:read']);

    const response = await invoke(token, { connectorId: 'gmail', capabilityRef: 'messages.list', input: {} });

    expect(response.status).toBe(401);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://gmail.googleapis.com/'))).toBe(false);
  });

  it('denies unallowlisted Gmail capabilities and unknown connectors without Google egress', async () => {
    const fetchMock = await installFetch();
    const token = await issueToken(['mcp:tools:invoke']);

    const response = await invoke(token, { connectorId: 'gmail', capabilityRef: 'messages.send', input: {} });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'connector_not_found' } });
    const unknown = await invoke(token, { connectorId: 'other', capabilityRef: 'messages.list', input: {} });
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({ error: { code: 'connector_not_found' } });
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://gmail.googleapis.com/'))).toBe(false);
  });

  it('binds the host principal to the verified token instead of request input', async () => {
    const fetchMock = await installFetch();
    const token = await issueToken(['mcp:tools:invoke']);

    const response = await invoke(token, {
      connectorId: 'gmail',
      capabilityRef: 'messages.list',
      input: { query: 'from:me', sessionPrincipalSub: 'another-user' },
    });

    expect(response.status).toBe(200);
    const googleCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://gmail.googleapis.com/'));
    expect((googleCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${gmailAccessToken}` });
  });

  it('surfaces unavailable and unreadable connector secrets distinctly', async () => {
    const fetchMock = await installFetch();
    const token = await issueToken(['mcp:tools:invoke']);
    await replaceGmailSecret(encryptSecret(JSON.stringify({
      accessToken: '', refreshToken: null, idToken: null, tokenType: 'Bearer', scope: GMAIL_READONLY_SCOPE,
      scopes: [GMAIL_READONLY_SCOPE], obtainedAt: new Date().toISOString(), expiresAt: null,
    })));

    const unavailable = await invoke(token, { connectorId: 'gmail', capabilityRef: 'messages.list', input: {} });
    expect(unavailable.status).toBe(409);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: 'connector_secret_unavailable', retriable: false },
    });

    await replaceGmailSecret('enc:v2:iv:tag:body');
    const unreadable = await invoke(token, { connectorId: 'gmail', capabilityRef: 'messages.list', input: {} });
    expect(unreadable.status).toBe(502);
    await expect(unreadable.json()).resolves.toMatchObject({
      error: {
        code: 'connector_secret_unreadable', retriable: true,
        detail: { reason: 'unsupported_version', version: 'v2' },
      },
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://gmail.googleapis.com/'))).toBe(false);
  });

  it('reads Gmail resources through the resources-read scope guard', async () => {
    await installFetch(new Response(JSON.stringify({ id: 'message-1', threadId: 'thread-1' }), { status: 200 }));
    const token = await issueToken(['mcp:resources:read']);

    const response = await readResource(token, {
      connectorId: 'gmail', capabilityRef: 'messages.get', input: { uri: 'gmail://messages/message-1' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, output: { id: 'message-1' } });
  });

  it('returns deterministic initialize responses without provider effects', async () => {
    const fetchMock = await installFetch();
    const token = await issueToken([]);
    const initialize = () => app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize' }),
    });

    const first = await (await initialize()).json();
    const second = await (await initialize()).json();
    expect(second).toEqual(first);
    expect(first).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a non-descriptive 400 for a malformed connector request', async () => {
    const token = await issueToken(['mcp:tools:invoke']);

    const response = await invoke(token, { connectorId: 'gmail' });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'invalid_request', message: 'Request body is invalid.' },
    });
  });

});

/**
 * `authorization_servers` is not decoration. mcp-auth uses it TWICE: it is published in the PRM so
 * a client knows where to fetch the RFC 8414 metadata, and it is the expected `iss` of every access
 * token (`core.ts:158`). Naming a host that issues nothing, or serves no metadata, breaks the flow
 * in two different ways at once.
 *
 * The PRM test above asserts only that the array is non-empty — a criterion the exact wrong value
 * satisfies: preprod shipped `["http://localhost:8787"]` and that assertion stayed green. This one
 * names the value.
 */
describe('MCP authorization server selection', () => {
  const originalEnabled = process.env.MCP_RESOURCE_SERVER_ENABLED;
  const originalAuthorizationServer = process.env.MCP_AUTHORIZATION_SERVER_URL;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.MCP_RESOURCE_SERVER_ENABLED;
    else process.env.MCP_RESOURCE_SERVER_ENABLED = originalEnabled;
    if (originalAuthorizationServer === undefined) delete process.env.MCP_AUTHORIZATION_SERVER_URL;
    else process.env.MCP_AUTHORIZATION_SERVER_URL = originalAuthorizationServer;
    vi.resetModules();
  });

  it('advertises the configured authorization server rather than this api', async () => {
    process.env.MCP_RESOURCE_SERVER_ENABLED = 'true';
    process.env.MCP_AUTHORIZATION_SERVER_URL = 'https://idp.example.test';

    // A FRESH module graph is required, and that is the point: `getMcpAuth` memoises into a
    // module-level `cachedMcp` on its first call, and `env` is parsed at import time. Nothing set
    // after import can be observed — which is exactly why the wrong value survived a pod's whole
    // lifetime in preprod. The statically imported `app` above is untouched by resetModules, so
    // the other suites in this file keep their own instance.
    //
    // Only the MCP router is re-imported, never `src/app`: re-running the full app's import-time
    // side effects (the skill registry parses SKILL.md files, among others) fails for reasons that
    // have nothing to do with what is under test here.
    vi.resetModules();
    const [{ mcpRouter }, { productMcpModule }] = await Promise.all([
      import('../../src/routes/api/mcp'),
      import('../../src/routes/namespaces/mcp'),
    ]);
    const legacy = new Hono().route('/api/v1/mcp', mcpRouter);
    const candidate = new Hono().route('/api/v1/mcp', productMcpModule.createRouter({
      context: { async verify() { throw new Error('not used by PRM'); } },
      receipts: { async append() { throw new Error('not used by PRM'); } },
    }));
    const path = '/api/v1/mcp/.well-known/oauth-protected-resource';
    const [legacyResponse, candidateResponse] = await Promise.all([
      legacy.request(path),
      candidate.request(path),
    ]);
    expect(legacyResponse.status).toBe(200);
    expect(candidateResponse.status).toBe(200);
    const legacyDoc = await legacyResponse.json() as { authorization_servers: string[] };
    const candidateDoc = await candidateResponse.json() as { authorization_servers: string[] };
    expect(candidateDoc).toEqual(legacyDoc);
    expect(candidateDoc.authorization_servers).toEqual(['https://idp.example.test']);
  });
});
