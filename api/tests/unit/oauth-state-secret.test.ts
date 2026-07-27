import { randomBytes } from 'node:crypto';

import { createOAuthHmacStateCodec, type OAuthContinuationState } from '@sentropic/auth-hono';
import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env';
import { createSentropicOAuthOptions } from '../../src/routes/auth/oauth';

const originalJwtSecret = env.JWT_SECRET;
const originalOAuthSigningKek = env.OAUTH_SIGNING_KEK;

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
});
