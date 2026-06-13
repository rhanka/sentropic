import type {
  AuthCodePayload,
  OauthClientRecord,
  OauthStateStorePort,
  ServiceClientRecord,
  TokenMeta,
} from '@sentropic/auth-hono';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';

import { db } from '../../db/client';
import {
  authorizationCodes,
  oauthClients,
  oauthDpopProofs,
  oauthTokens,
  revokedTokens,
  serviceClients,
} from '../../db/schema';

interface CreateOauthStateStoreAdapterOptions {
  database?: typeof db;
  now?: () => Date;
}

export const createOauthStateStoreAdapter = (
  options: CreateOauthStateStoreAdapterOptions = {}
): OauthStateStorePort => {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());
  const expiresFromTtl = (ttlSec: number): Date => new Date(now().getTime() + ttlSec * 1000);

  return {
    async consumeAuthCode(code) {
      const [row] = await database
        .update(authorizationCodes)
        .set({ usedAt: now() })
        .where(
          and(
            eq(authorizationCodes.code, code),
            isNull(authorizationCodes.usedAt),
            gt(authorizationCodes.expiresAt, now())
          )
        )
        .returning();

      return row ? toAuthCodePayload(row) : null;
    },

    async findClient(clientId) {
      const [row] = await database
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1);

      return row ? toOauthClientRecord(row) : null;
    },

    async findServiceClient(clientId) {
      const [row] = await database
        .select()
        .from(serviceClients)
        .where(and(eq(serviceClients.clientId, clientId), isNull(serviceClients.revokedAt)))
        .limit(1);

      return row ? toServiceClientRecord(row) : null;
    },

    async findTokenMeta(jti) {
      const [row] = await database
        .select()
        .from(oauthTokens)
        .where(and(eq(oauthTokens.jti, jti), gt(oauthTokens.expiresAt, now())))
        .limit(1);

      return row ? toTokenMeta(row) : null;
    },

    async isTokenRevoked(jti) {
      const [row] = await database
        .select({ jti: revokedTokens.jti })
        .from(revokedTokens)
        .where(and(eq(revokedTokens.jti, jti), gt(revokedTokens.expiresAt, now())))
        .limit(1);

      return Boolean(row);
    },

    async purgeExpired() {
      const expiredAt = now();
      const [codes, tokens, proofs, revoked] = await Promise.all([
        database.delete(authorizationCodes).where(lt(authorizationCodes.expiresAt, expiredAt)).returning(),
        database.delete(oauthTokens).where(lt(oauthTokens.expiresAt, expiredAt)).returning(),
        database.delete(oauthDpopProofs).where(lt(oauthDpopProofs.expiresAt, expiredAt)).returning(),
        database.delete(revokedTokens).where(lt(revokedTokens.expiresAt, expiredAt)).returning(),
      ]);

      return codes.length + tokens.length + proofs.length + revoked.length;
    },

    async recordDpopJti(jti, expiresAt) {
      const inserted = await database
        .insert(oauthDpopProofs)
        .values({ createdAt: now(), expiresAt, jti })
        .onConflictDoNothing()
        .returning({ jti: oauthDpopProofs.jti });

      return inserted.length === 1;
    },

    async revokeToken(jti) {
      const [tokenRow] = await database
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.jti, jti))
        .limit(1);
      const expiresAt = tokenRow?.expiresAt ?? now();

      await database
        .insert(revokedTokens)
        .values({
          clientId: tokenRow?.clientId ?? null,
          expiresAt,
          jti,
          revokedAt: now(),
          tenantId: tokenRow?.tenantId ?? null,
          userId: tokenRow?.userId ?? null,
        })
        .onConflictDoUpdate({
          set: { revokedAt: now() },
          target: revokedTokens.jti,
        });

      return true;
    },

    async saveAuthCode(code, payload, ttlSec) {
      await database.insert(authorizationCodes).values({
        clientId: payload.clientId,
        code,
        codeChallenge: payload.codeChallenge,
        codeChallengeMethod: payload.codeChallengeMethod,
        createdAt: payload.createdAt,
        dpopJkt: payload.dpopJkt,
        expiresAt: expiresFromTtl(ttlSec),
        nonce: payload.nonce,
        payload,
        redirectUri: payload.redirectUri,
        scope: payload.scope,
        tenantId: payload.tenantId,
        userId: payload.userId,
      });
    },

    async saveTokenMeta(jti, meta, ttlSec) {
      await database
        .insert(oauthTokens)
        .values({
          audience: meta.audience,
          clientId: meta.clientId,
          createdAt: meta.createdAt,
          dpopJkt: meta.dpopJkt,
          expiresAt: expiresFromTtl(ttlSec),
          jti,
          scope: meta.scope,
          tenantId: meta.tenantId,
          tokenType: meta.tokenType,
          userId: meta.userId,
        })
        .onConflictDoUpdate({
          set: {
            audience: meta.audience,
            dpopJkt: meta.dpopJkt,
            expiresAt: expiresFromTtl(ttlSec),
            scope: meta.scope,
          },
          target: oauthTokens.jti,
        });
    },
  };
};

const toOauthClientRecord = (row: typeof oauthClients.$inferSelect): OauthClientRecord => ({
  allowedScopes: row.allowedScopes,
  clientId: row.clientId,
  clientSecretHash: row.clientSecretHash,
  createdAt: row.createdAt,
  dpopBoundAccessTokens: row.dpopBoundAccessTokens,
  grantTypes: row.grantTypes,
  id: row.id,
  name: row.name,
  ownerUserId: row.ownerUserId,
  redirectUris: row.redirectUris,
  requirePkce: row.requirePkce,
  resourceIndicators: row.resourceIndicators,
  responseTypes: row.responseTypes,
  tenantId: row.tenantId,
  tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
  updatedAt: row.updatedAt ?? row.createdAt,
});

const toServiceClientRecord = (row: typeof serviceClients.$inferSelect): ServiceClientRecord => ({
  allowedScopes: row.allowedScopes,
  clientId: row.clientId,
  clientSecretHash: row.clientSecretHash,
  createdAt: row.createdAt,
  displayName: row.displayName,
  dpopBoundAccessTokens: row.dpopBoundAccessTokens,
  id: row.id,
  resourceIndicators: row.resourceIndicators,
  revokedAt: row.revokedAt,
  secretRotatedAt: row.secretRotatedAt,
  tenantId: row.tenantId,
});

const toAuthCodePayload = (row: typeof authorizationCodes.$inferSelect): AuthCodePayload => {
  const payload = row.payload as Partial<AuthCodePayload> | null;

  return {
    acr: typeof payload?.acr === 'string' ? payload.acr : 'urn:sentropic:loa:passkey-fresh',
    authTime: toDate(payload?.authTime) ?? row.createdAt,
    clientId: row.clientId,
    codeChallenge: row.codeChallenge,
    codeChallengeMethod: 'S256',
    createdAt: row.createdAt,
    dpopJkt: row.dpopJkt,
    expiresAt: row.expiresAt,
    nonce: row.nonce,
    redirectUri: row.redirectUri,
    resource: typeof payload?.resource === 'string' ? payload.resource : null,
    scope: row.scope,
    tenantId: row.tenantId,
    userId: row.userId,
  };
};

const toTokenMeta = (row: typeof oauthTokens.$inferSelect): TokenMeta => ({
  audience: row.audience,
  clientId: row.clientId,
  createdAt: row.createdAt,
  dpopJkt: row.dpopJkt,
  expiresAt: row.expiresAt,
  jti: row.jti,
  scope: row.scope,
  tenantId: row.tenantId,
  tokenType: row.tokenType as TokenMeta['tokenType'],
  userId: row.userId,
});

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return null;
};
