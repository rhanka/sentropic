import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_CODE_LOAD_CODE_ASSIST_URL,
  CLOUD_CODE_TOKEN_URL,
  CLOUD_CODE_USER_AGENT,
  CLOUD_CODE_USERINFO_URL,
  fetchCloudCodeUserInfo,
  loadCodeAssist,
  onboardCloudCodeUser,
} from '../../../src/services/cloud-code-provider-auth';

describe('cloud-code-provider-auth service', () => {
  it('fetchCloudCodeUserInfo retrieves user profile with Bearer token', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url.toString()).toBe(CLOUD_CODE_USERINFO_URL);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer valid-access-token' });
      return new Response(
        JSON.stringify({
          id: 'gaia-user-123',
          email: 'testuser@example.com',
          name: 'Test User',
          picture: 'https://example.com/avatar.jpg',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const info = await fetchCloudCodeUserInfo('valid-access-token', fetchMock as unknown as typeof fetch);
    expect(info).toEqual({
      id: 'gaia-user-123',
      email: 'testuser@example.com',
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg',
    });
  });

  it('loadCodeAssist sends exact User-Agent and extracts cloudaicompanionProject', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url.toString()).toBe(CLOUD_CODE_LOAD_CODE_ASSIST_URL);
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer test-token',
        'User-Agent': CLOUD_CODE_USER_AGENT,
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ metadata: { ideType: 'ANTIGRAVITY' } });

      return new Response(
        JSON.stringify({ cloudaicompanionProject: 'daily-cloudcode-proj-456' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const res = await loadCodeAssist('test-token', fetchMock as unknown as typeof fetch);
    expect(res.cloudaicompanionProject).toBe('daily-cloudcode-proj-456');
  });

  it('loadCodeAssist throws an error when no cloudaicompanionProject is returned', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      loadCodeAssist('test-token', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow('returned no cloudaicompanionProject');
  });

  it('onboardCloudCodeUser completes OAuth exchange and resolves project & profile', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'cc-access-123',
            refresh_token: 'cc-refresh-123',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: 'proj-onboarded-789' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('userinfo')) {
        return new Response(
          JSON.stringify({ email: 'onboard@example.com', name: 'Onboard User' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const result = await onboardCloudCodeUser(
      {
        code: 'oauth-code',
        codeVerifier: 'pkce-verifier',
        redirectUri: 'http://localhost/callback',
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(result.accessToken).toBe('cc-access-123');
    expect(result.refreshToken).toBe('cc-refresh-123');
    expect(result.cloudaicompanionProject).toBe('proj-onboarded-789');
    expect(result.email).toBe('onboard@example.com');
  });
});
