import type { OAuthConsentDetails, OAuthConsentTransport } from '@sentropic/auth-ui';

import { ApiError, apiFetch, apiFetchResponse } from '$lib/api';

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

const IDP_OAUTH_PATH = '/api/v1/auth/oauth';

export const createIdpOAuthConsentTransport = (
  options: CreateIdpOAuthConsentTransportOptions = {},
): OAuthConsentTransport => ({
  async getConsent({ state }): Promise<OAuthConsentDetails> {
    return withUnauthorizedHandler(options, async () => {
      const params = new URLSearchParams({ state });
      const response = await apiFetch(`${IDP_OAUTH_PATH}/consent?${params.toString()}`, {
        method: 'GET',
      });
      return response.json() as Promise<OAuthConsentDetails>;
    });
  },

  async submitConsentDecision(input): Promise<{ redirectTo: string }> {
    return withUnauthorizedHandler(options, async () => {
      const response = await apiFetch(`${IDP_OAUTH_PATH}/consent/decision`, {
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
  return `${IDP_OAUTH_PATH}/authorize?${params.toString()}`;
};

export const fetchOAuthLoginPolicy = async (
  continuation: string,
): Promise<{ magicLinkSignIn: boolean }> => {
  try {
    const params = new URLSearchParams({ continue: continuation });
    const response = await apiFetchResponse(`${IDP_OAUTH_PATH}/login-policy?${params.toString()}`, {
      method: 'GET',
    });
    if (!response.ok) return { magicLinkSignIn: false };
    const data = (await response.json()) as { magicLinkSignIn?: unknown };
    return { magicLinkSignIn: data?.magicLinkSignIn === true };
  } catch {
    return { magicLinkSignIn: false };
  }
};

const FORWARD_AUTH_PARAMS = ['continue', 'login_hint', 'returnUrl'] as const;

export const buildAuthForwardQuery = (search: string): string => {
  const incoming = new URLSearchParams(search);
  const forwarded = new URLSearchParams();
  for (const key of FORWARD_AUTH_PARAMS) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const encoded = forwarded.toString();
  return encoded ? `?${encoded}` : '';
};

export const resolveSafeReturnUrl = (raw: string | null | undefined, fallback = '/auth/signed-in'): string => {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback;
  }
  return trimmed;
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
