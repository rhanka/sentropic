import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { fromJwksPort, parseScopes, TokenVerifyError, verifyAccessToken } from '../src/index.js';
import { createMemoryJwksProvider, createSigningKey, type TestSigningKey } from './__fixtures__/jwks.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const issuer = 'https://idp.sentropic.test';
const audience = 'https://api.sentropic.test';

const signAccessToken = async (
  key: TestSigningKey,
  claims: Record<string, unknown> = {},
  options: { audience?: string; expiresAt?: Date; issuer?: string; kid?: string } = {}
): Promise<string> =>
  new SignJWT({ client_id: 'service-rp', scope: 'service:ping service:read', ...claims })
    .setProtectedHeader({ alg: 'EdDSA', kid: options.kid ?? key.kid })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject('service-rp')
    .setExpirationTime(Math.floor((options.expiresAt ?? new Date(now.getTime() + 900_000)).getTime() / 1000))
    .sign(key.privateKey);

describe('verifyAccessToken', () => {
  it('accepts a valid token and returns its claims', async () => {
    const key = await createSigningKey();
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await signAccessToken(key);

    const claims = await verifyAccessToken({ audience, issuer, keySource, now, token });

    expect(claims.client_id).toBe('service-rp');
    expect(claims.iss).toBe(issuer);
    expect(parseScopes(claims.scope)).toContain('service:ping');
  });

  it('rejects a token signed by an unknown key', async () => {
    const key = await createSigningKey();
    const foreign = await createSigningKey('kid-2');
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await signAccessToken(foreign, {}, { kid: foreign.kid });

    await expect(verifyAccessToken({ audience, issuer, keySource, now, token })).rejects.toBeInstanceOf(
      TokenVerifyError
    );
  });

  it('rejects an expired token', async () => {
    const key = await createSigningKey();
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await signAccessToken(key, {}, { expiresAt: new Date('2025-12-31T23:00:00.000Z') });

    await expect(verifyAccessToken({ audience, issuer, keySource, now, token })).rejects.toThrow(/invalid|expired/iu);
  });

  it('rejects a token with the wrong audience', async () => {
    const key = await createSigningKey();
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await signAccessToken(key, {}, { audience: 'https://other.example.test' });

    await expect(verifyAccessToken({ audience, issuer, keySource, now, token })).rejects.toBeInstanceOf(
      TokenVerifyError
    );
  });

  it('rejects a token with the wrong issuer', async () => {
    const key = await createSigningKey();
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await signAccessToken(key, {}, { issuer: 'https://evil.example.test' });

    await expect(verifyAccessToken({ audience, issuer, keySource, now, token })).rejects.toBeInstanceOf(
      TokenVerifyError
    );
  });

  it('rejects a token that is missing a required scope', async () => {
    const key = await createSigningKey();
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await signAccessToken(key);

    await expect(
      verifyAccessToken({ audience, issuer, keySource, now, requiredScopes: ['service:admin'], token })
    ).rejects.toThrow(/Missing required scope/u);
  });

  it('accepts a token that carries all required scopes', async () => {
    const key = await createSigningKey();
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await signAccessToken(key);

    const claims = await verifyAccessToken({
      audience,
      issuer,
      keySource,
      now,
      requiredScopes: ['service:ping', 'service:read'],
      token,
    });

    expect(claims.sub).toBe('service-rp');
  });

  it('resolves the active key when the token omits a kid', async () => {
    const key = await createSigningKey('only-key');
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));
    const token = await new SignJWT({ scope: 'service:ping' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('service-rp')
      .setExpirationTime(Math.floor((now.getTime() + 900_000) / 1000))
      .sign(key.privateKey);

    const claims = await verifyAccessToken({ audience, issuer, keySource, now, token });
    expect(claims.sub).toBe('service-rp');
  });

  it('rejects a structurally invalid token', async () => {
    const key = await createSigningKey();
    const keySource = fromJwksPort(createMemoryJwksProvider([key]));

    await expect(verifyAccessToken({ audience, issuer, keySource, now, token: 'not-a-jwt' })).rejects.toBeInstanceOf(
      TokenVerifyError
    );
  });
});
