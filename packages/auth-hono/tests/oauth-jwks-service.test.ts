import { describe, expect, it } from 'vitest';

import { createJwksService, type AuthHonoClockPort } from '../src/index.js';
import { createJwksKeyRecord, createMemoryJwksPort } from './__fixtures__/memory-jwks.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-01T01:00:00.000Z');
const issuer = 'http://localhost:9197';
const audience = `${issuer}/api/v1/auth/oauth/userinfo`;

const clock: AuthHonoClockPort = {
  addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000),
  now: () => now,
};

describe('createJwksService', () => {
  it('signs and verifies JWTs with the active Ed25519 key', async () => {
    const key = await createJwksKeyRecord({ active: true, kid: 'kid-active', now });
    const service = createJwksService({ clock, jwksPort: createMemoryJwksPort([key]) });

    const jwt = await service.signJwt(
      {
        client_id: 'example-mock-rp',
        scope: 'openid profile email',
      },
      {
        audience,
        expiresAt,
        issuer,
        subject: 'user-1',
      }
    );

    const verified = await service.verifyJwt(jwt, { audience, currentDate: now, issuer });

    expect(verified.protectedHeader.kid).toBe('kid-active');
    expect(verified.payload).toMatchObject({
      aud: audience,
      client_id: 'example-mock-rp',
      iss: issuer,
      scope: 'openid profile email',
      sub: 'user-1',
    });
  });

  it('keeps verifying tokens signed by a rotated key that is still in JWKS', async () => {
    const oldKey = await createJwksKeyRecord({ active: true, kid: 'kid-old', now });
    const port = createMemoryJwksPort([oldKey]);
    const service = createJwksService({ clock, jwksPort: port });
    const jwt = await service.signJwt({ token_use: 'access_token' }, { audience, expiresAt, issuer });

    const newKey = await createJwksKeyRecord({ active: true, kid: 'kid-new', now });
    port.keys = [{ ...oldKey, active: false, rotatedAt: now }, newKey];

    const verified = await service.verifyJwt(jwt, { audience, currentDate: now, issuer });

    expect(verified.protectedHeader.kid).toBe('kid-old');
    expect(verified.payload.token_use).toBe('access_token');
  });

  it('rejects tokens whose kid is no longer present', async () => {
    const oldKey = await createJwksKeyRecord({ active: true, kid: 'kid-old', now });
    const port = createMemoryJwksPort([oldKey]);
    const service = createJwksService({ clock, jwksPort: port });
    const jwt = await service.signJwt({ token_use: 'access_token' }, { audience, expiresAt, issuer });
    port.keys = [await createJwksKeyRecord({ active: true, kid: 'kid-new', now })];

    await expect(service.verifyJwt(jwt, { audience, currentDate: now, issuer })).rejects.toThrow(/kid-old/);
  });

  it('returns public JWKS entries without private material', async () => {
    const activeKey = await createJwksKeyRecord({ active: true, kid: 'kid-active', now });
    const rotatedKey = await createJwksKeyRecord({ active: false, kid: 'kid-rotated', now });
    const service = createJwksService({
      clock,
      jwksPort: createMemoryJwksPort([activeKey, rotatedKey]),
    });

    const jwks = await service.getPublicJwks();

    expect(jwks.keys).toEqual([
      expect.objectContaining({
        alg: 'EdDSA',
        crv: 'Ed25519',
        kid: 'kid-active',
        kty: 'OKP',
        status: 'active',
        use: 'sig',
      }),
      expect.objectContaining({
        kid: 'kid-rotated',
        status: 'rotated',
      }),
    ]);
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(jwks.keys[0]).not.toHaveProperty('privateKey');
  });
});
