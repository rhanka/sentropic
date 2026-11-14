import { createHmac, randomBytes } from 'node:crypto';

import { createOAuthHmacStateCodec, type OAuthContinuationState } from '@sentropic/auth-hono';
import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env';
import { DEVELOPMENT_SECRET_SEED } from '../../src/config/deployment-secrets';
import { createSentropicOAuthOptions, resolveSessionTokenSecret } from '../../src/routes/auth/oauth';
import { createJwksAdapter } from '../../src/services/auth/jwks-adapter';
import { createGoogleDriveOAuthState } from '../../src/services/google-drive-oauth';

const LEGACY_LITERAL = 'dev-secret-key-change-in-production-please';

const originalJwtSecret = env.JWT_SECRET;
const originalOAuthSigningKek = env.OAUTH_SIGNING_KEK;
const mutable = env as unknown as Record<string, unknown>;
const originalRuntime = { NODE_ENV: env.NODE_ENV, DISABLE_RATE_LIMIT: env.DISABLE_RATE_LIMIT, ADMIN_EMAIL: env.ADMIN_EMAIL };

const statePayload: OAuthContinuationState = {
  clientId: 'secret-separation-client',
  codeChallenge: 'secret-separation-challenge',
  codeChallengeMethod: 'S256',
  createdAt: '2026-07-27T12:00:00.000Z',
  dpopJkt: null,
  expiresAt: '2026-07-27T12:05:00.000Z',
  nonce: null,
  redirectUri: 'https://client.example.test/callback',
  scope: 'openid',
  state: null,
  tenantId: null,
};

describe('OAuth continuation state key separation', () => {
  afterEach(() => {
    env.JWT_SECRET = originalJwtSecret;
    env.OAUTH_SIGNING_KEK = originalOAuthSigningKek;
    Object.assign(mutable, originalRuntime);
  });

  it('uses the OAuth signing KEK when JWT_SECRET is also configured', async () => {
    const jwtSecret = randomBytes(48).toString('base64url');
    const oauthSigningKek = randomBytes(48).toString('base64url');
    env.JWT_SECRET = jwtSecret;
    env.OAUTH_SIGNING_KEK = oauthSigningKek;

    const hostCodec = createSentropicOAuthOptions().stateCodec;
    const oauthKekCodec = createOAuthHmacStateCodec({ secret: oauthSigningKek });
    const jwtCodec = createOAuthHmacStateCodec({ secret: jwtSecret });
    const sealedState = await hostCodec.seal(statePayload);

    await expect(oauthKekCodec.unseal(sealedState)).resolves.toEqual(statePayload);
    await expect(jwtCodec.unseal(sealedState)).resolves.toBeNull();
  });

  it('should refuse short, blank and public keys in deployed OAuth, Drive and JWKS resolvers', () => {
    Object.assign(mutable, { NODE_ENV: 'production', DISABLE_RATE_LIMIT: 'false', ADMIN_EMAIL: 'deployed@example.test' });
    for (const value of [undefined, '', 'x', 'x'.repeat(31), ' '.repeat(32), DEVELOPMENT_SECRET_SEED,
      'dev-idp-signing-kek-change-in-production']) {
      env.OAUTH_SIGNING_KEK = value;
      env.JWT_SECRET = value;
      expect(() => createSentropicOAuthOptions()).toThrow(/provisioned/);
      expect(() => createGoogleDriveOAuthState({ userId: 'u', workspaceId: 'w' })).toThrow(/provisioned/);
      expect(() => createJwksAdapter()).toThrow(/provisioned/);
    }
  });

  it('should select a provisioned JWT for state but never for deployed JWKS', async () => {
    Object.assign(mutable, { NODE_ENV: 'production', DISABLE_RATE_LIMIT: 'false', ADMIN_EMAIL: 'deployed@example.test' });
    env.JWT_SECRET = 'j'.repeat(32);
    for (const value of ['short', ' dev-idp-signing-kek-change-in-production ']) {
      env.OAUTH_SIGNING_KEK = value;
      const state = await createSentropicOAuthOptions().stateCodec.seal(statePayload);
      await expect(createOAuthHmacStateCodec({ secret: env.JWT_SECRET }).unseal(state)).resolves.toEqual(statePayload);
      const [payload, signature] = createGoogleDriveOAuthState({ userId: 'u', workspaceId: 'w' }).state.split('.');
      expect(signature).toBe(createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url'));
      expect(() => createJwksAdapter()).toThrow(/OAUTH_SIGNING_KEK/);
    }
    env.OAUTH_SIGNING_KEK = 'k'.repeat(32);
    expect(() => createJwksAdapter()).not.toThrow();
  });

  it('should treat empty JWKS keys as absent in development', () => {
    mutable.NODE_ENV = 'test';
    env.OAUTH_SIGNING_KEK = '';
    env.JWT_SECRET = '';
    expect(() => createJwksAdapter({ oauthSigningKek: '' })).not.toThrow();
  });

  it('should preserve the provisioned KEK bytes and precedence in deployed state codecs', async () => {
    Object.assign(mutable, { NODE_ENV: 'production', DISABLE_RATE_LIMIT: 'false', ADMIN_EMAIL: 'deployed@example.test' });
    env.OAUTH_SIGNING_KEK = ` ${'k'.repeat(32)} `;
    env.JWT_SECRET = 'j'.repeat(32);
    const state = await createSentropicOAuthOptions().stateCodec.seal(statePayload);
    await expect(createOAuthHmacStateCodec({ secret: env.OAUTH_SIGNING_KEK }).unseal(state)).resolves.toEqual(statePayload);
    await expect(createOAuthHmacStateCodec({ secret: env.JWT_SECRET }).unseal(state)).resolves.toBeNull();
    const [payload, signature] = createGoogleDriveOAuthState({ userId: 'u', workspaceId: 'w' }).state.split('.');
    expect(signature).toBe(createHmac('sha256', env.OAUTH_SIGNING_KEK).update(payload).digest('base64url'));
  });
});

describe('session-token secret resolution', () => {
  afterEach(() => {
    env.JWT_SECRET = originalJwtSecret;
  });

  it('treats an EMPTY JWT_SECRET as absent rather than as the key', () => {
    // THE case this exists for, and the only one that discriminates `||` from `??`. The secret bundle
    // emits every key it knows as `--from-literal=VAR="$VAR"`, so an environment whose source env file
    // omits the value receives an EMPTY string, not an absent variable. Under `??` that empty string
    // survives and becomes a zero-length HMAC key for session and verification tokens — real
    // authentication material. Reverting this resolver to `??` must break this assertion.
    env.JWT_SECRET = '';
    expect(resolveSessionTokenSecret()).toBe(LEGACY_LITERAL);
    expect(resolveSessionTokenSecret().length).toBeGreaterThan(0);
  });

  it('keeps the deployed key byte-identical when no JWT_SECRET is delivered', () => {
    // Production carries no JWT_SECRET today, so this is the live value and it must not move: the
    // whole point of this step is a decoupling that changes no bytes. Written out rather than
    // imported on purpose — editing the literal in the source must break this test.
    env.JWT_SECRET = undefined;
    expect(resolveSessionTokenSecret()).toBe(LEGACY_LITERAL);
  });

  it('uses JWT_SECRET once a non-empty value is delivered', () => {
    const delivered = randomBytes(48).toString('base64url');
    env.JWT_SECRET = delivered;
    expect(resolveSessionTokenSecret()).toBe(delivered);
    expect(resolveSessionTokenSecret()).not.toBe(LEGACY_LITERAL);
  });
});
