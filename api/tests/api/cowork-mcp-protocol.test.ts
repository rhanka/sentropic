// Cowork MCP protocol surface (BR-41d, Lot 1): disabled 404s, 401 + PRM,
// 405s, JSON-RPC round-trips, body/Origin/Host bounds. Admitted tokens only
// where the path requires them; admission cases live in cowork-mcp-admission.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';
import type { JwksAdapter } from '../../src/services/auth/jwks-adapter';
import { createTestUser, type TestUser } from '../utils/auth-helper';
import {
  cleanupCoworkData,
  COWORK_TEST_CLIENT_ID,
  COWORK_TEST_ISSUER,
  COWORK_TEST_RESOURCE,
  disableCoworkEnv,
  enableCoworkEnv,
  ensureCoworkSigningKey,
  mintCoworkToken,
  saveCoworkTokenMeta,
  seedCoworkClient,
} from '../utils/cowork-fixtures';

const PRM_PATH = `${COWORK_TEST_RESOURCE}/.well-known/oauth-protected-resource`;
const EXPECTED_WWW = `Bearer error="invalid_token", error_description="Authorization header is required.", scope="cowork:control", resource_metadata="${PRM_PATH}"`;

const postJson = (body: unknown, init: { token?: string; origin?: string; url?: string } = {}) =>
  app.request(init.url ?? COWORK_TEST_RESOURCE, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
      'content-type': 'application/json',
    },
    method: 'POST',
  });

const initializeBody = { id: 1, jsonrpc: '2.0', method: 'initialize', params: { capabilities: {}, clientInfo: { name: 'test', version: '0' }, protocolVersion: '2025-06-18' } };

describe('cowork MCP protocol', () => {
  let user: TestUser;
  let jwks: JwksAdapter;
  let token: string;
  const jtis: string[] = [];

  beforeEach(async () => {
    user = await createTestUser({ role: 'editor' });
    enableCoworkEnv({ ownerSub: user.id });
    await seedCoworkClient(COWORK_TEST_CLIENT_ID, COWORK_TEST_RESOURCE);
    jwks = await ensureCoworkSigningKey();
    const minted = await mintCoworkToken(jwks, { clientId: COWORK_TEST_CLIENT_ID, scopes: ['cowork:control'], subject: user.id });
    jtis.push(minted.jti);
    token = minted.token;
    await saveCoworkTokenMeta(minted.jti, { clientId: COWORK_TEST_CLIENT_ID, scope: 'cowork:control', userId: user.id });
  });

  afterEach(async () => {
    await cleanupCoworkData([COWORK_TEST_CLIENT_ID], jtis.splice(0));
    disableCoworkEnv();
  });

  describe('when disabled', () => {
    beforeEach(() => disableCoworkEnv());

    it('returns 404 for POST', async () => {
      expect((await postJson(initializeBody, { token })).status).toBe(404);
    });

    it('returns 404 for the PRM well-known', async () => {
      expect((await app.request(PRM_PATH)).status).toBe(404);
    });

    it('returns 404 for GET', async () => {
      expect((await app.request(COWORK_TEST_RESOURCE)).status).toBe(404);
    });
  });

  it('challenges a tokenless request with the exact 401 + prefixed PRM pointer', async () => {
    const res = await postJson(initializeBody);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe(EXPECTED_WWW);
  });

  it('serves the exact PRM document', async () => {
    const res = await app.request(PRM_PATH);
    expect(res.status).toBe(200);
    const doc = await res.json() as { authorization_servers: string[]; resource: string; scopes_supported: string[] };
    expect(doc.resource).toBe(COWORK_TEST_RESOURCE);
    expect(doc.authorization_servers).toEqual([COWORK_TEST_ISSUER]);
    expect(doc.scopes_supported).toEqual(['cowork:control']);
  });

  it('answers GET with 405', async () => {
    const res = await app.request(COWORK_TEST_RESOURCE);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('negotiates initialize deterministically', async () => {
    const first = await (await postJson(initializeBody, { token })).json();
    const second = await (await postJson(initializeBody, { token })).json();
    expect(second).toEqual(first);
    expect(first.result.serverInfo.name).toBe('sentropic-cowork-mcp');
    expect(typeof first.result.protocolVersion).toBe('string');
  });

  it('answers notifications with 202 and no body', async () => {
    for (const method of ['notifications/initialized', 'notifications/cancelled']) {
      const res = await postJson({ jsonrpc: '2.0', method }, { token });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe('');
    }
  });

  it('lists no tools in Lot 1', async () => {
    const res = await postJson({ id: 2, jsonrpc: '2.0', method: 'tools/list', params: {} }, { token });
    expect(res.status).toBe(200);
    expect((await res.json()).result.tools).toEqual([]);
  });

  it('returns a parse error for malformed JSON', async () => {
    const res = await postJson('{oops', { token });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: -32700 }, id: null, jsonrpc: '2.0' });
  });

  it('returns Invalid Request for a non-RPC shape', async () => {
    const res = await postJson({ id: 7, jsonrpc: '2.0', method: 42 }, { token });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: -32600 }, id: 7 });
  });

  it('refuses an oversized body with 413', async () => {
    const res = await postJson(`"${'x'.repeat(1_200_000)}"`, { token });
    expect(res.status).toBe(413);
  });

  it('refuses a foreign Origin with 403', async () => {
    const res = await postJson(initializeBody, { origin: 'https://evil.example', token });
    expect(res.status).toBe(403);
  });

  it('refuses an unknown Host with 403', async () => {
    const res = await postJson(initializeBody, { token, url: 'https://unknown.example/api/v1/cowork-mcp' });
    expect(res.status).toBe(403);
  });
});
