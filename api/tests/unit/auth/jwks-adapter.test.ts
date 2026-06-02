import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createJwksService } from '@sentropic/auth-hono';
import { db } from '../../../src/db/client';
import { idTokenSigningKeys } from '../../../src/db/schema';
import { createJwksAdapter } from '../../../src/services/auth/jwks-adapter';

const now = new Date('2026-01-01T00:00:00.000Z');
const issuer = 'http://localhost:9197';
const audience = `${issuer}/api/v1/auth/oauth/userinfo`;
const clock = {
  addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
  now: () => now,
};

const createAdapter = (kek = 'test-oauth-signing-kek') =>
  createJwksAdapter({ now: () => now, oauthSigningKek: kek });

describe('createJwksAdapter', () => {
  beforeEach(async () => {
    await db.delete(idTokenSigningKeys);
  });

  afterEach(async () => {
    await db.delete(idTokenSigningKeys);
  });

  it('generates an active Ed25519 signing key and returns public JWKS data', async () => {
    const adapter = createAdapter();

    await adapter.generateAndStoreNewKey({ kid: 'kid-active' });

    const active = await adapter.getActiveKey();
    const publicKeys = await adapter.listPublicKeys();

    expect(active).toMatchObject({
      active: true,
      alg: 'EdDSA',
      crv: 'Ed25519',
      kid: 'kid-active',
    });
    expect(active?.privateKey).toBeDefined();
    expect(publicKeys).toEqual([
      expect.objectContaining({
        active: true,
        kid: 'kid-active',
        publicJwk: expect.objectContaining({ kty: 'OKP', crv: 'Ed25519', x: expect.any(String) }),
      }),
    ]);
  });

  it('keeps rotated public keys while exposing only one active key', async () => {
    const adapter = createAdapter();

    await adapter.generateAndStoreNewKey({ kid: 'kid-old' });
    await adapter.generateAndStoreNewKey({ kid: 'kid-new' });

    const keys = await adapter.listPublicKeys();

    expect(keys.map((key) => ({ active: key.active, kid: key.kid }))).toEqual([
      { active: true, kid: 'kid-new' },
      { active: false, kid: 'kid-old' },
    ]);
  });

  it('decrypts private keys for signing but stores only encrypted bytes', async () => {
    const adapter = createAdapter();
    await adapter.generateAndStoreNewKey({ kid: 'kid-active' });
    const service = createJwksService({ clock, jwksPort: adapter });

    const jwt = await service.signJwt(
      { client_id: 'example-mock-rp' },
      { audience, expiresAt: new Date('2026-01-01T01:00:00.000Z'), issuer, subject: 'user-1' }
    );
    const verified = await service.verifyJwt(jwt, { audience, currentDate: now, issuer });
    const [stored] = await db
      .select({ privateKeyEncrypted: idTokenSigningKeys.privateKeyEncrypted })
      .from(idTokenSigningKeys)
      .where(eq(idTokenSigningKeys.kid, 'kid-active'))
      .limit(1);

    expect(verified.payload.sub).toBe('user-1');
    expect(String(stored.privateKeyEncrypted)).not.toContain('PRIVATE KEY');
  });

  it('fails to decrypt an existing key with the wrong KEK', async () => {
    await createAdapter('kek-one').generateAndStoreNewKey({ kid: 'kid-active' });

    await expect(createAdapter('kek-two').getActiveKey()).rejects.toThrow();
  });
});
