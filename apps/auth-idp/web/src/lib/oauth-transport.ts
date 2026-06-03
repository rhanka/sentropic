import type { OAuthConsentDetails, OAuthConsentTransport } from '@sentropic/auth-ui';

import { ApiError, apiFetch } from '$lib/api';

// BR-39m A0-bis — IdP-origin OAuth consent transport + authorize continuation.
//
// Line-by-line analog of the product `ui/`
// `src/lib/services/oauth-transport.ts`, except same-origin: the IdP serves the
// consent screen and its OIDC API on one origin, so consent endpoints are the
// absolute IdP paths `/api/v1/auth/oauth/consent*` and the authorize
// continuation re-enters the same-origin `/api/v1/auth/oauth/authorize`.

interface CreateIdpOAuthConsentTransportOptions {
  onUnauthorized?: () => void;
}

export const createIdpOAuthConsentTransport = (
  options: CreateIdpOAuthConsentTransportOptions = {},
): OAuthConsentTransport => ({
  async getConsent({ state }): Promise<OAuthConsentDetails> {
    return withUnauthorizedHandler(options, async () => {
      const params = new URLSearchParams({ state });
      const response = await apiFetch(`/api/v1/auth/oauth/consent?${params.toString()}`, {
        method: 'GET',
      });
      return response.json() as Promise<OAuthConsentDetails>;
    });
  },

  async submitConsentDecision(input): Promise<{ redirectTo: string }> {
    return withUnauthorizedHandler(options, async () => {
      const response = await apiFetch('/api/v1/auth/oauth/consent/decision', {
        body: JSON.stringify(input),
        headers: {
          Accept: 'application/json',
        },
        method: 'POST',
      });
      return response.json() as Promise<{ redirectTo: string }>;
    });
  },
});

// After a successful login the IdP must resume the OAuth authorize flow it was
// interrupted on. The authorize handler issued `loginUrl?continue=<sealed>`;
// here we re-enter the same-origin authorize endpoint with that continuation.
export const resolveOAuthAuthorizeContinuationUrl = (continuation: string): string => {
  const params = new URLSearchParams({ continue: continuation });
  return `/api/v1/auth/oauth/authorize?${params.toString()}`;
};

const withUnauthorizedHandler = async <T>(
  options: CreateIdpOAuthConsentTransportOptions,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      options.onUnauthorized?.();
    }
    throw error;
  }
};
