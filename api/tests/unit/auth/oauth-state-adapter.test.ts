import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import {
  authorizationCodes,
  oauthClients,
  oauthDpopProofs,
  oauthTokens,
  revokedTokens,
  serviceClients,
} from '../../../src/db/schema';
import { createOauthStateStoreAdapter } from '../../../src/services/auth/oauth-state-adapter';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { cmDeleteForUsers } from '../../utils/cm-identity-test-store';

const now = new Date('2026-01-01T00:00:00.000Z');
const future = new Date('2026-01-01T01:00:00.000Z');
const past = new Date('2025-12-31T23:00:00.000Z');
const userId = 'oauth-state-user-1';
const clientId = 'example-mock-rp';

type StatePort = ReturnType<typeof createOauthStateStoreAdapter>;
// Each protocol operation gets a real independent request transaction, including races.
const run = <T>(work: (port: StatePort) => Promise<T>) => runCmIdentityWrite(transaction =>
  work(createOauthStateStoreAdapter({ transaction, now: () => now })));
const createAdapter = () => ({
  findClient: (...args: Parameters<StatePort['findClient']>) => run(port => port.findClient(...args)),
  findServiceClient: (id: string) => run(port => port.findServiceClient!(id)),
  saveAuthCode: (...args: Parameters<StatePort['saveAuthCode']>) => run(port => port.saveAuthCode(...args)),
  consumeAuthCode: (...args: Parameters<StatePort['consumeAuthCode']>) => run(port => port.consumeAuthCode(...args)),
  saveTokenMeta: (...args: Parameters<StatePort['saveTokenMeta']>) => run(port => port.saveTokenMeta(...args)),
  findTokenMeta: (...args: Parameters<StatePort['findTokenMeta']>) => run(port => port.findTokenMeta(...args)),
  isTokenRevoked: (...args: Parameters<StatePort['isTokenRevoked']>) => run(port => port.isTokenRevoked(...args)),
  revokeToken: (...args: Parameters<StatePort['revokeToken']>) => run(port => port.revokeToken(...args)),
  recordDpopJti: (...args: Parameters<StatePort['recordDpopJti']>) => run(port => port.recordDpopJti(...args)),
  purgeExpired: () => run(port => port.purgeExpired()),
});

const createPayload = (expiresAt = future) => ({
  acr: 'urn:sentropic:loa:passkey-fresh',
  authTime: now,
  clientId,
  codeChallenge: 'challenge',
  codeChallengeMethod: 'S256' as const,
  createdAt: now,
  dpopJkt: null,
  expiresAt,
  nonce: 'nonce-1',
  redirectUri: 'http://localhost:5397/auth/oauth/callback',
  scope: 'openid profile email',
  tenantId: null,
  userId,
});

const createTokenMeta = (jti = 'jti-1', expiresAt = future) => ({
  audience: 'http://localhost:9197/api/v1/auth/oauth/userinfo',
  clientId,
  createdAt: now,
  dpopJkt: null,
  expiresAt,
  jti,
  scope: 'openid profile email',
  tenantId: null,
  tokenType: 'access_token' as const,
  userId,
});

describe('createOauthStateStoreAdapter', () => {
  beforeEach(async () => {
    await db.delete(serviceClients);
    await db.delete(revokedTokens);
    await db.delete(oauthDpopProofs);
    await db.delete(oauthTokens);
    await db.delete(authorizationCodes);
    await db.delete(oauthClients);
    await cmDeleteForUsers([userId]);
    await createCmUser({
      displayName: 'OAuth State User',
      email: 'oauth-state-user@example.com',
      emailVerified: true,
      userId,
      role: 'editor',
      accountStatus: 'active',
    });
    await db.insert(oauthClients).values({
      allowedScopes: ['openid', 'profile', 'email'],
      clientId,
      clientSecretHash: 'hash:secret',
      createdAt: now,
      id: 'oauth-client-1',
      name: 'Example Mock RP',
      redirectUris: ['http://localhost:5397/auth/oauth/callback'],
      updatedAt: now,
    });
  });

  afterEach(async () => {
    await db.delete(serviceClients);
    await db.delete(revokedTokens);
    await db.delete(oauthDpopProofs);
    await db.delete(oauthTokens);
    await db.delete(authorizationCodes);
    await db.delete(oauthClients);
    await cmDeleteForUsers([userId]);
  });

  it('finds clients and consumes authorization codes atomically once', async () => {
    const adapter = createAdapter();

    await expect(adapter.findClient(clientId)).resolves.toMatchObject({
      allowedScopes: ['openid', 'profile', 'email'],
      clientId,
      redirectUris: ['http://localhost:5397/auth/oauth/callback'],
    });

    await adapter.saveAuthCode('code-1', createPayload(), 60);
    const consumed = await Promise.all([
      adapter.consumeAuthCode('code-1'),
      adapter.consumeAuthCode('code-1'),
    ]);

    expect(consumed.filter(Boolean)).toHaveLength(1);
    expect(consumed.find(Boolean)).toMatchObject({
      clientId,
      codeChallengeMethod: 'S256',
      userId,
    });
  });

  it('fails closed to bearer when a stored code payload lacks an ACR (F7)', async () => {
    const adapter = createAdapter();
    const { acr: _dropped, amr: _droppedAmr, ...payloadWithoutAcr } = createPayload();

    await adapter.saveAuthCode('code-no-acr', payloadWithoutAcr, 60);
    const consumed = await adapter.consumeAuthCode('code-no-acr');

    expect(consumed?.acr).toBe('urn:sentropic:loa:bearer');
    expect(consumed?.amr).toEqual(['pwd']);
  });

  it('stores token metadata and revokes by jti', async () => {
    const adapter = createAdapter();

    await adapter.saveTokenMeta('jti-1', createTokenMeta(), 3600);

    await expect(adapter.findTokenMeta('jti-1')).resolves.toMatchObject({
      clientId,
      jti: 'jti-1',
      tokenType: 'access_token',
      userId,
    });
    await expect(adapter.isTokenRevoked('jti-1')).resolves.toBe(false);
    await expect(adapter.revokeToken('jti-1')).resolves.toBe(true);
    await expect(adapter.isTokenRevoked('jti-1')).resolves.toBe(true);
  });

  it('deduplicates DPoP proof jtis and purges expired state', async () => {
    const adapter = createAdapter();

    await expect(adapter.recordDpopJti('proof-1', future)).resolves.toBe(true);
    await expect(adapter.recordDpopJti('proof-1', future)).resolves.toBe(false);

    await adapter.saveAuthCode('expired-code', createPayload(past), -60);
    await adapter.saveTokenMeta('expired-jti', createTokenMeta('expired-jti', past), -60);
    await adapter.recordDpopJti('expired-proof', past);
    await adapter.revokeToken('expired-jti');

    await expect(adapter.purgeExpired()).resolves.toBeGreaterThanOrEqual(4);
    await expect(adapter.consumeAuthCode('expired-code')).resolves.toBeNull();
    await expect(adapter.findTokenMeta('expired-jti')).resolves.toBeNull();
  });

  it('finds active service clients and ignores revoked or missing ones', async () => {
    const adapter = createAdapter();

    await db.insert(serviceClients).values({
      allowedScopes: ['service:ping', 'service:read'],
      clientId: 'service-active',
      clientSecretHash: 'hash:service-secret',
      createdAt: now,
      displayName: 'Active Service',
      dpopBoundAccessTokens: false,
      id: 'service-active-row',
      resourceIndicators: ['https://api.sentropic.test'],
      tenantId: null,
    });
    await db.insert(serviceClients).values({
      allowedScopes: ['service:ping'],
      clientId: 'service-revoked',
      clientSecretHash: 'hash:service-secret',
      createdAt: now,
      displayName: 'Revoked Service',
      dpopBoundAccessTokens: false,
      id: 'service-revoked-row',
      resourceIndicators: [],
      revokedAt: now,
      tenantId: null,
    });

    await expect(adapter.findServiceClient?.('service-active')).resolves.toMatchObject({
      allowedScopes: ['service:ping', 'service:read'],
      clientId: 'service-active',
      dpopBoundAccessTokens: false,
      resourceIndicators: ['https://api.sentropic.test'],
    });
    await expect(adapter.findServiceClient?.('service-revoked')).resolves.toBeNull();
    await expect(adapter.findServiceClient?.('service-missing')).resolves.toBeNull();
  });

  it('maps a valid exchange policy and fails closed on malformed or absent policies', async () => {
    const adapter = createAdapter();
    const policy = {
      actorSub: 'immo-mcp-workload',
      allowClientCredentials: false,
      allowedScopes: ['immo:read', 'immo:search'],
      allowedSubjectAudiences: ['https://immo.sent-tech.ca/mcp'],
      allowedSubjectClients: ['immo-mcp'],
      allowedTargetAudiences: ['https://immo.sent-tech.ca'],
      enabled: true,
      environment: null,
      maxTtlSeconds: 300,
    };

    await db.insert(serviceClients).values({
      allowedScopes: ['immo:read', 'immo:search'],
      clientId: 'service-exchange',
      clientSecretHash: 'hash:service-secret',
      createdAt: now,
      displayName: 'Exchange Service',
      dpopBoundAccessTokens: false,
      exchangePolicy: policy,
      id: 'service-exchange-row',
      resourceIndicators: ['https://immo.sent-tech.ca'],
      tenantId: null,
    });
    await db.insert(serviceClients).values({
      allowedScopes: ['service:ping'],
      clientId: 'service-malformed',
      clientSecretHash: 'hash:service-secret',
      createdAt: now,
      displayName: 'Malformed Service',
      dpopBoundAccessTokens: false,
      exchangePolicy: { enabled: true, actorSub: 'x' },
      id: 'service-malformed-row',
      resourceIndicators: [],
      tenantId: null,
    });
    await db.insert(serviceClients).values({
      allowedScopes: ['service:ping'],
      clientId: 'service-legacy',
      clientSecretHash: 'hash:service-secret',
      createdAt: now,
      displayName: 'Legacy Service',
      dpopBoundAccessTokens: false,
      id: 'service-legacy-row',
      resourceIndicators: [],
      tenantId: null,
    });

    await expect(adapter.findServiceClient?.('service-exchange')).resolves.toMatchObject({
      clientId: 'service-exchange',
      exchangePolicy: {
        actorSub: 'immo-mcp-workload',
        allowClientCredentials: false,
        enabled: true,
        maxTtlSeconds: 300,
      },
    });
    await expect(
      adapter.findServiceClient?.('service-malformed')?.then((client) => client?.exchangePolicy ?? null),
    ).resolves.toMatchObject({ allowClientCredentials: false, enabled: false });
    await expect(
      adapter.findServiceClient?.('service-legacy')?.then((client) => client?.exchangePolicy ?? null),
    ).resolves.toBeNull();
  });
});
