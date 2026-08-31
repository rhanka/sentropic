import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '../../src/lib/config';
import {
  createSentropicOAuthConsentTransport,
  resolveOAuthAuthorizeContinuationUrl,
} from '../../src/lib/services/oauth-transport';
import { ApiError } from '../../src/lib/utils/api';
import { mockFetchJsonOnce, resetFetchMock } from '../test-setup';

describe('Sentropic OAuth consent transport', () => {
  beforeEach(() => {
    resetFetchMock();
    localStorage.clear();
  });

  it('fetches consent details from the mounted auth OAuth endpoint', async () => {
    mockFetchJsonOnce({
      clientName: 'Example Mock RP',
      redirectUri: 'http://localhost:5397/auth/oauth/callback',
      scopes: ['openid', 'profile', 'email'],
    });

    const transport = createSentropicOAuthConsentTransport();
    const details = await transport.getConsent({ state: 'sealed state' });

    expect(details.clientName).toBe('Example Mock RP');
    expect(details.scopes).toEqual(['openid', 'profile', 'email']);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/oauth/consent?state=sealed+state`);
    expect(init?.method).toBe('GET');
  });

  it('submits consent decisions as JSON and asks the handler for a JSON redirect', async () => {
    mockFetchJsonOnce({
      redirectTo: 'http://localhost:5397/auth/oauth/callback?code=code-1&state=state-1',
    });

    const transport = createSentropicOAuthConsentTransport();
    const result = await transport.submitConsentDecision({
      decision: 'approve',
      state: 'sealed-state',
    });

    expect(result.redirectTo).toContain('/auth/oauth/callback?code=code-1');

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/oauth/consent/decision`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ decision: 'approve', state: 'sealed-state' }));
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  it('notifies unauthorized consent calls before rethrowing the API error', async () => {
    const onUnauthorized = vi.fn();
    mockFetchJsonOnce({ error: 'login_required', message: 'A valid user session is required.' }, 401);

    const transport = createSentropicOAuthConsentTransport({ onUnauthorized });

    await expect(transport.getConsent({ state: 'sealed-state' })).rejects.toMatchObject<ApiError>({
      status: 401,
      message: 'A valid user session is required.',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('builds the API authorize resume URL for post-login OAuth continuations', () => {
    expect(resolveOAuthAuthorizeContinuationUrl('sealed state')).toBe(
      `${API_BASE_URL}/oauth/authorize?continue=sealed+state`,
    );
  });
});
