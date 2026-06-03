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
  users,
} from '../../../src/db/schema';
import { createOauthStateStoreAdapter } from '../../../src/services/auth/oauth-state-adapter';

const now = new Date('2026-01-01T00:00:00.000Z');
const future = new Date('2026-01-01T01:00:00.000Z');
const past = new Date('2025-12-31T23:00:00.000Z');
const userId = 'oauth-state-user-1';
const clientId = 'example-mock-rp';

const createAdapter = () => createOauthStateStoreAdapter({ now: () => now });

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
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(users).values({
      createdAt: now,
      displayName: 'OAuth State User',
      email: 'oauth-state-user@example.com',
      emailVerified: true,
      id: userId,
      role: 'editor',
      updatedAt: now,
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
    await db.delete(users).where(eq(users.id, userId));
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
});
