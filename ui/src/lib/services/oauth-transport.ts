import type {
  OAuthConsentDetails,
  OAuthConsentTransport,
} from '@sentropic/auth-ui';

import { API_BASE_URL } from '$lib/config';
import { ApiError, apiFetch } from '$lib/utils/api';

interface CreateSentropicOAuthConsentTransportOptions {
  onUnauthorized?: () => void;
}

const PRODUCT_OAUTH_PATH = '/oauth';

export const createSentropicOAuthConsentTransport = (
  options: CreateSentropicOAuthConsentTransportOptions = {},
): OAuthConsentTransport => ({
  async getConsent({ state }): Promise<OAuthConsentDetails> {
    return withUnauthorizedHandler(options, async () => {
      const params = new URLSearchParams({ state });
      const response = await apiFetch(`${PRODUCT_OAUTH_PATH}/consent?${params.toString()}`, {
        method: 'GET',
      });
      return response.json() as Promise<OAuthConsentDetails>;
    });
  },

  async submitConsentDecision(input): Promise<{ redirectTo: string }> {
    return withUnauthorizedHandler(options, async () => {
      const response = await apiFetch(`${PRODUCT_OAUTH_PATH}/consent/decision`, {
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

export const resolveOAuthAuthorizeContinuationUrl = (continuation: string): string => {
  const params = new URLSearchParams({ continue: continuation });
  return `${API_BASE_URL}${PRODUCT_OAUTH_PATH}/authorize?${params.toString()}`;
};

const withUnauthorizedHandler = async <T>(
  options: CreateSentropicOAuthConsentTransportOptions,
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
