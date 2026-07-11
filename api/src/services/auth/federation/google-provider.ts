import { Google } from 'arctic';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { FederationProvider, FederationProviderIdentity } from './types';

/**
 * BR-39e Lot 1 — Google OIDC provider (the reference case, D8 auto-link-allowlisted).
 *
 * `arctic` supplies the typed RP layer (authorization-URL builder + PKCE code→token exchange);
 * `jose` verifies the returned id_token (signature via Google's JWKS + issuer + audience) and the
 * OIDC nonce. The external tokens are used ONLY inside `verifyCallback` and dropped (D1 no-leak) —
 * the broker receives just {subject, email, emailVerified}.
 */

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
// Google's id_token `iss` is one of these two forms.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_SCOPES = ['openid', 'profile', 'email'];

// A single remote JWKS for Google's rotating signing keys (jose caches + refreshes internally).
let googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const getGoogleJwks = (): ReturnType<typeof createRemoteJWKSet> => {
  googleJwks ??= createRemoteJWKSet(GOOGLE_JWKS_URL);
  return googleJwks;
};

export interface GoogleProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const createGoogleProvider = (config: GoogleProviderConfig): FederationProvider => {
  const google = new Google(config.clientId, config.clientSecret, config.redirectUri);

  return {
    id: 'google',

    createAuthorizationUrl({ codeVerifier, nonce, state }) {
      const url = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);
      // OIDC nonce binds this authorization to the id_token we verify on callback (D10).
      url.searchParams.set('nonce', nonce);
      return url.toString();
    },

    async verifyCallback({ code, codeVerifier, nonce }): Promise<FederationProviderIdentity> {
      // Exchange the code (PKCE verifier) for tokens directly from Google's token endpoint (TLS).
      const tokens = await google.validateAuthorizationCode(code, codeVerifier ?? '');
      const idToken = tokens.idToken();

      // Verify signature (Google JWKS) + issuer + audience — never trust an unverified id_token (D10).
      const { payload } = await jwtVerify(idToken, getGoogleJwks(), {
        audience: config.clientId,
        issuer: GOOGLE_ISSUERS,
      });

      // OIDC nonce must match the one bound at start (anti-replay); a mismatch aborts the login.
      if (typeof nonce === 'string' && payload.nonce !== nonce) {
        throw new Error('Google id_token nonce mismatch.');
      }

      const subject = typeof payload.sub === 'string' ? payload.sub : null;
      if (!subject) {
        throw new Error('Google id_token is missing the subject claim.');
      }

      const email = typeof payload.email === 'string' ? payload.email : null;
      const emailVerified = payload.email_verified === true;

      // The external tokens are intentionally NOT returned — they are dropped here (D1 broker model).
      return { email, emailVerified, subject };
    },
  };
};
