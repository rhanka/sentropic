// Cowork admission cases (BR-41d, Lot 1): INV-01 singletons, INV-02 fresh
// revocation/client/owner reads, INV-05 tier isolation, 503 on store outage.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { users } from '../../src/db/schema';
import type { JwksAdapter } from '../../src/services/auth/jwks-adapter';
import { createTestUser, type TestUser } from '../utils/auth-helper';
import {
  cleanupCoworkData,
  COWORK_TEST_CLIENT_ID,
  COWORK_TEST_RESOURCE,
  disableCoworkEnv,
  enableCoworkEnv,
  ensureCoworkSigningKey,
  mintCoworkToken,
  revokeCoworkToken,
  saveCoworkTokenMeta,
  seedCoworkClient,
} from '../utils/cowork-fixtures';

const storeFault = vi.hoisted(() => ({ throwOnRead: false }));

vi.mock('../../src/services/auth/oauth-state-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/auth/oauth-state-adapter')>();
  return {
    ...actual,
    createOauthStateStoreAdapter: (...args: Parameters<typeof actual.createOauthStateStoreAdapter>) => {
      const store = actual.createOauthStateStoreAdapter(...args);
      if (!storeFault.throwOnRead) return store;
      const down = async (): Promise<never> => { throw new Error('store down'); };
      return { ...store, findClient: down, findTokenMeta: down, isTokenRevoked: down };
    },
  };
});

const PROD_RESOURCE = 'https://sentropic.sent-tech.ca/api/v1/cowork-mcp';
const PROD_ISSUER = 'https://auth.sent-tech.ca';
const INIT = { id: 1, jsonrpc: '2.0', method: 'initialize', params: { capabilities: {}, protocolVersion: '2025-06-18' } };

const postInit = (token: string, url = COWORK_TEST_RESOURCE) =>
  app.request(url, { body: JSON.stringify(INIT), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, method: 'POST' });

describe('cowork MCP admission', () => {
  let user: TestUser;
  let jwks: JwksAdapter;
  let token: string;
  let jti: string;
  const jtis: string[] = [];

  beforeEach(async () => {
    user = await createTestUser({ role: 'editor' });
    enableCoworkEnv({ ownerSub: user.id });
    await seedCoworkClient(COWORK_TEST_CLIENT_ID, COWORK_TEST_RESOURCE);
    jwks = await ensureCoworkSigningKey();
    const minted = await mintCoworkToken(jwks, { clientId: COWORK_TEST_CLIENT_ID, scopes: ['cowork:control'], subject: user.id });
    jtis.push(minted.jti);
    jti = minted.jti;
    token = minted.token;
    await saveCoworkTokenMeta(jti, { clientId: COWORK_TEST_CLIENT_ID, scope: 'cowork:control', userId: user.id });
  });

  afterEach(async () => {
    storeFault.throwOnRead = false;
    await cleanupCoworkData([COWORK_TEST_CLIENT_ID], jtis.splice(0));
    disableCoworkEnv();
  });

  it('admits a valid owner token to initialize', async () => {
    const res = await postInit(token);
    expect(res.status).toBe(200);
    expect((await res.json()).result.serverInfo.name).toBe('sentropic-cowork-mcp');
  });

  it('refuses a wrong audience with 401', async () => {
    const minted = await mintCoworkToken(jwks, { clientId: COWORK_TEST_CLIENT_ID, resource: 'https://other.example/api', scopes: ['cowork:control'], subject: user.id });
    jtis.push(minted.jti);
    expect((await postInit(minted.token)).status).toBe(401);
  });

  it('refuses a preprod issuer under a prod config with 401', async () => {
    enableCoworkEnv({ issuer: PROD_ISSUER, ownerSub: user.id, resource: PROD_RESOURCE });
    const minted = await mintCoworkToken(jwks, { clientId: COWORK_TEST_CLIENT_ID, issuer: COWORK_TEST_ISSUER, resource: PROD_RESOURCE, scopes: ['cowork:control'], subject: user.id });
    jtis.push(minted.jti);
    expect((await postInit(minted.token, PROD_RESOURCE)).status).toBe(401);
  });

  it('refuses a wrong subject with 401', async () => {
    const other = await createTestUser({ role: 'editor' });
    const minted = await mintCoworkToken(jwks, { clientId: COWORK_TEST_CLIENT_ID, scopes: ['cowork:control'], subject: other.id });
    jtis.push(minted.jti);
    expect((await postInit(minted.token)).status).toBe(401);
  });

  it('refuses a wrong client_id with 401', async () => {
    const minted = await mintCoworkToken(jwks, { clientId: 'other-client', scopes: ['cowork:control'], subject: user.id });
    jtis.push(minted.jti);
    expect((await postInit(minted.token)).status).toBe(401);
  });

  it('refuses a missing scope with 403 + step-up scope', async () => {
    const minted = await mintCoworkToken(jwks, { clientId: COWORK_TEST_CLIENT_ID, scopes: ['mcp:tools:invoke'], subject: user.id });
    jtis.push(minted.jti);
    const res = await postInit(minted.token);
    expect(res.status).toBe(403);
    expect(res.headers.get('WWW-Authenticate')).toContain('scope="cowork:control"');
  });

  it('refuses a revoked jti before exp with 401', async () => {
    await revokeCoworkToken(jti);
    const res = await postInit(token);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_token');
  });

  it('refuses a token without meta with 401', async () => {
    const minted = await mintCoworkToken(jwks, { clientId: COWORK_TEST_CLIENT_ID, scopes: ['cowork:control'], subject: user.id });
    jtis.push(minted.jti);
    expect((await postInit(minted.token)).status).toBe(401);
  });

  it('refuses when the client scope was removed with 401', async () => {
    await seedCoworkClient(COWORK_TEST_CLIENT_ID, COWORK_TEST_RESOURCE, ['other:scope']);
    expect((await postInit(token)).status).toBe(401);
  });

  it('refuses when the client resource was removed with 401', async () => {
    await seedCoworkClient(COWORK_TEST_CLIENT_ID, 'https://other.example/api', ['cowork:control']);
    expect((await postInit(token)).status).toBe(401);
  });

  it('refuses a disabled owner with 401', async () => {
    await db.update(users).set({ accountStatus: 'suspended', disabledAt: new Date() }).where(eq(users.id, user.id));
    expect((await postInit(token)).status).toBe(401);
  });

  it('denies with 503 and no challenge when the store throws', async () => {
    storeFault.throwOnRead = true;
    const res = await postInit(token);
    expect(res.status).toBe(503);
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
    expect((await res.json()).error.code).toBe('admission_unavailable');
  });
});
