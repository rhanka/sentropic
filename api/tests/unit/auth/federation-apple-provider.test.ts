import {
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { describe, expect, it } from 'vitest';

import {
  createAppleProvider,
  mintAppleClientSecret,
} from '../../../src/services/auth/federation/apple-provider';

const ISSUER = 'https://appleid.apple.com';
const CLIENT_ID = 'ca.sentropic.auth';
const TEAM_ID = 'TEAM123456';
const KEY_ID = 'KEY1234567';

const keyPair = async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  return { ...pair, privateKeyPem: await exportPKCS8(pair.privateKey) };
};

const appleIdToken = async (
  privateKey: CryptoKey,
  overrides: { audience?: string; issuer?: string; nonce?: string } = {},
): Promise<string> =>
  new SignJWT({
    email: 'relay@privaterelay.appleid.com',
    email_verified: 'true',
    nonce: overrides.nonce ?? 'bound-nonce',
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'apple-signing-key' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? CLIENT_ID)
    .setSubject('apple-subject-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

describe('Apple federation provider', () => {
  it('K-APPLE-SECRET: mints a verifiable five-minute ES256 client-secret JWT', async () => {
    const { privateKeyPem, publicKey } = await keyPair();
    const now = 1_800_000_000;
    const secret = await mintAppleClientSecret({
      clientId: CLIENT_ID,
      keyId: KEY_ID,
      now,
      privateKeyPem,
      teamId: TEAM_ID,
    });

    expect(decodeProtectedHeader(secret)).toMatchObject({ alg: 'ES256', kid: KEY_ID });
    const { payload } = await jwtVerify(secret, publicKey, { audience: ISSUER, issuer: TEAM_ID });
    expect(payload).toMatchObject({ aud: ISSUER, exp: now + 300, iat: now, iss: TEAM_ID, sub: CLIENT_ID });
    expect(payload.exp).toBeGreaterThan(payload.iat!);
  });

  it('requests name/email with form_post, state, and nonce', async () => {
    const { privateKeyPem } = await keyPair();
    const provider = createAppleProvider({
      clientId: CLIENT_ID,
      keyId: KEY_ID,
      privateKeyPem,
      redirectUri: 'https://issuer.test/auth/federation/apple/callback',
      teamId: TEAM_ID,
    });

    const url = new URL(await provider.createAuthorizationUrl({
      codeVerifier: 'unused-by-arctic-apple',
      nonce: 'bound-nonce',
      state: 'csrf-state',
    }));
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('scope')).toBe('name email');
    expect(url.searchParams.get('state')).toBe('csrf-state');
    expect(url.searchParams.get('nonce')).toBe('bound-nonce');
  });

  it('verifies the id_token and marks private-relay email as Apple-scoped', async () => {
    const { privateKey, privateKeyPem, publicKey } = await keyPair();
    const token = await appleIdToken(privateKey);
    const provider = createAppleProvider({
      client: {
        createAuthorizationURL: () => new URL(`${ISSUER}/auth/authorize`),
        validateAuthorizationCode: async () => ({ idToken: () => token }),
      },
      clientId: CLIENT_ID,
      keyId: KEY_ID,
      privateKeyPem,
      redirectUri: 'https://issuer.test/auth/federation/apple/callback',
      teamId: TEAM_ID,
      verificationKey: publicKey,
    });

    const identity = await provider.verifyCallback({
      code: 'authorization-code',
      codeVerifier: null,
      nonce: 'bound-nonce',
      profile: { displayName: 'Ada Lovelace', email: 'relay@privaterelay.appleid.com' },
    });
    expect(identity).toEqual({
      displayName: 'Ada Lovelace',
      email: 'relay@privaterelay.appleid.com',
      emailScope: 'provider',
      emailVerified: true,
      subject: 'apple-subject-1',
    });
    expect(identity).not.toHaveProperty('accessToken');
  });

  it.each([
    ['missing expected nonce', null, {}, /nonce/i],
    ['mismatched nonce', 'wrong-nonce', {}, /nonce/i],
    ['wrong issuer', 'bound-nonce', { issuer: 'https://evil.test' }, /iss/i],
    ['wrong audience', 'bound-nonce', { audience: 'other-client' }, /aud/i],
  ])('rejects %s', async (_label, nonce, overrides, message) => {
    const { privateKey, privateKeyPem, publicKey } = await keyPair();
    const token = await appleIdToken(privateKey, overrides);
    const provider = createAppleProvider({
      client: {
        createAuthorizationURL: () => new URL(`${ISSUER}/auth/authorize`),
        validateAuthorizationCode: async () => ({ idToken: () => token }),
      },
      clientId: CLIENT_ID,
      keyId: KEY_ID,
      privateKeyPem,
      redirectUri: 'https://issuer.test/auth/federation/apple/callback',
      teamId: TEAM_ID,
      verificationKey: publicKey,
    });

    await expect(provider.verifyCallback({ code: 'code', codeVerifier: null, nonce })).rejects.toThrow(message);
  });
});
