import { Facebook } from 'arctic';

import type { FederationProvider, FederationProviderIdentity } from './types';

/**
 * BR-39e Lot 5 — Facebook provider (OAuth2 + Graph profile, no id_token).
 *
 * Facebook email is optional and low-assurance, so it is always returned as unverified. The shared
 * broker consequently routes a new Facebook identity through the existing D9 email challenge before
 * writing a user or identity. The access token is used for one Graph request and then dropped (D1).
 */

const FACEBOOK_PROFILE_URL = 'https://graph.facebook.com/me?fields=id,name,email';
const FACEBOOK_SCOPES = ['email', 'public_profile'];

export interface FacebookProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injectable for tests; defaults to global `fetch` and is used only for the Graph profile call. */
  fetchImpl?: typeof fetch;
}

interface FacebookProfileResponse {
  id?: unknown;
  name?: unknown;
  email?: unknown;
}

/** Derive the stable Facebook subject and optional low-assurance email from one Graph API call. */
export async function fetchFacebookIdentity(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<FederationProviderIdentity> {
  const response = await fetchImpl(FACEBOOK_PROFILE_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Facebook Graph profile request failed with status ${response.status}.`);
  }

  const profile = (await response.json()) as FacebookProfileResponse;
  if (typeof profile.id !== 'string' || profile.id.length === 0) {
    throw new Error('Facebook Graph profile response is missing the string account id.');
  }

  return {
    email: typeof profile.email === 'string' && profile.email.length > 0 ? profile.email : null,
    // Facebook does not provide a strong email-verification assertion for this Graph field (D8/D9).
    emailVerified: false,
    subject: profile.id,
  };
}

export const createFacebookProvider = (config: FacebookProviderConfig): FederationProvider => {
  const facebook = new Facebook(config.clientId, config.clientSecret, config.redirectUri);
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    id: 'facebook',

    createAuthorizationUrl({ state }) {
      // The installed Arctic Facebook client has no PKCE parameter; state remains broker-bound.
      return facebook.createAuthorizationURL(state, FACEBOOK_SCOPES).toString();
    },

    async verifyCallback({ code }): Promise<FederationProviderIdentity> {
      const tokens = await facebook.validateAuthorizationCode(code);
      const accessToken = tokens.accessToken();

      // D1: token scope ends at this single Graph call; the returned identity has no token field.
      return fetchFacebookIdentity(fetchImpl, accessToken);
    },
  };
};
