import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';

import type { JwksKeyRecord, JwksPort, JwksPublicJwk } from '@sentropic/auth-hono';
import { exportJWK } from 'jose';
import { desc, eq, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import { db } from '../../db/client';
import { idTokenSigningKeys } from '../../db/schema';

interface CreateJwksAdapterOptions {
  database?: typeof db;
  isProduction?: boolean;
  now?: () => Date;
  oauthSigningKek?: string;
}

export interface JwksAdapter extends JwksPort {
  generateAndStoreNewKey(input?: { kid?: string }): Promise<JwksKeyRecord>;
  rotateActive(kid: string): Promise<void>;
}

export const createJwksAdapter = (options: CreateJwksAdapterOptions = {}): JwksAdapter => {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());
  const oauthSigningKek = resolveOauthSigningKek(options);
  let activeKeyCache: { expiresAt: number; key: JwksKeyRecord | null } | null = null;
  let publicKeysCache: { expiresAt: number; keys: JwksKeyRecord[] } | null = null;
  const cacheUntil = (): number => Date.now() + 60_000;
  const clearCache = (): void => {
    activeKeyCache = null;
    publicKeysCache = null;
  };

  const readPrivateKey = async (kid: string) => {
    const rows = await database.all(sql`
      SELECT pgp_sym_decrypt(private_key_encrypted, ${oauthSigningKek}) AS private_key_pem
      FROM id_token_signing_keys
      WHERE kid = ${kid}
      LIMIT 1
    `) as Array<{ private_key_pem: string }>;
    const privateKeyPem = rows[0]?.private_key_pem;
    if (!privateKeyPem) {
      throw new Error(`No private key material found for kid ${kid}.`);
    }
    return createPrivateKey(privateKeyPem);
  };

  return {
    async findKeyByKid(kid) {
      const [row] = await database
        .select()
        .from(idTokenSigningKeys)
        .where(eq(idTokenSigningKeys.kid, kid))
        .limit(1);

      return row ? toJwksKeyRecord(row) : null;
    },

    async generateAndStoreNewKey(input = {}) {
      const kid = input.kid ?? randomUUID();
      const generatedAt = now();
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const publicJwk = {
        ...(await exportJWK(publicKey)),
        alg: 'EdDSA',
        crv: 'Ed25519',
        kid,
        kty: 'OKP',
        use: 'sig',
      } as JwksPublicJwk;
      const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

      await database
        .update(idTokenSigningKeys)
        .set({ active: false, rotatedAt: generatedAt })
        .where(eq(idTokenSigningKeys.active, true));

      await database.execute(sql`
        INSERT INTO id_token_signing_keys
          (kid, alg, crv, public_jwk, private_key_encrypted, active, created_at, rotated_at)
        VALUES
          (${kid}, 'EdDSA', 'Ed25519', ${JSON.stringify(publicJwk)}::jsonb, pgp_sym_encrypt(${privateKeyPem}, ${oauthSigningKek}), true, ${generatedAt}, null)
      `);
      clearCache();

      return {
        active: true,
        alg: 'EdDSA',
        createdAt: generatedAt,
        crv: 'Ed25519',
        kid,
        privateKey,
        publicJwk,
        rotatedAt: null,
      };
    },

    async getActiveKey() {
      if (activeKeyCache && activeKeyCache.expiresAt > Date.now()) {
        return activeKeyCache.key;
      }

      const [row] = await database
        .select()
        .from(idTokenSigningKeys)
        .where(eq(idTokenSigningKeys.active, true))
        .limit(1);

      if (!row) {
        activeKeyCache = { expiresAt: cacheUntil(), key: null };
        return null;
      }
      const key = {
        ...toJwksKeyRecord(row),
        privateKey: await readPrivateKey(row.kid),
      };
      activeKeyCache = { expiresAt: cacheUntil(), key };
      return key;
    },

    async listPublicKeys() {
      if (publicKeysCache && publicKeysCache.expiresAt > Date.now()) {
        return publicKeysCache.keys;
      }

      const rows = await database
        .select()
        .from(idTokenSigningKeys)
        .orderBy(desc(idTokenSigningKeys.active), desc(idTokenSigningKeys.createdAt));

      const keys = rows.map(toJwksKeyRecord);
      publicKeysCache = { expiresAt: cacheUntil(), keys };
      return keys;
    },

    async rotateActive(kid) {
      const rotatedAt = now();
      await database
        .update(idTokenSigningKeys)
        .set({ active: false, rotatedAt })
        .where(eq(idTokenSigningKeys.active, true));
      await database
        .update(idTokenSigningKeys)
        .set({ active: true, rotatedAt: null })
        .where(eq(idTokenSigningKeys.kid, kid));
      clearCache();
    },
  };
};

const resolveOauthSigningKek = (options: CreateJwksAdapterOptions): string => {
  const isProduction = options.isProduction ?? env.NODE_ENV === 'production';
  const kek =
    options.oauthSigningKek ??
    env.OAUTH_SIGNING_KEK ??
    (isProduction ? undefined : env.JWT_SECRET ?? 'dev-secret-key-change-in-production-please');

  if (!kek) {
    throw new Error('OAUTH_SIGNING_KEK is required for OAuth signing key encryption in production.');
  }

  return kek;
};

const toJwksKeyRecord = (row: typeof idTokenSigningKeys.$inferSelect): JwksKeyRecord => ({
  active: row.active,
  alg: row.alg,
  createdAt: row.createdAt,
  crv: row.crv,
  kid: row.kid,
  publicJwk: row.publicJwk as JwksPublicJwk,
  rotatedAt: row.rotatedAt,
});
