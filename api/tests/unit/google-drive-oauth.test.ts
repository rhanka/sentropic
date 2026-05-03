import { describe, expect, it, vi } from 'vitest';
import {
  appendGoogleDriveOAuthResultToReturnPath,
  buildGoogleDriveAuthorizationUrl,
  createGoogleDriveOAuthState,
  exchangeGoogleDriveOAuthCode,
  refreshGoogleDriveAccessToken,
  verifyGoogleDriveOAuthState,
  type GoogleDriveOAuthConfig,
} from '../../src/services/google-drive-oauth';

const config: GoogleDriveOAuthConfig = {
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  redirectUri: 'https://api.example.test/api/v1/google-drive/oauth/callback',
};

describe('Google Drive OAuth helpers', () => {
  it('builds an absolute UI redirect URL when a frontend base URL is provided', () => {
    expect(
      appendGoogleDriveOAuthResultToReturnPath(
        '/folders?view=grid',
        { google_drive: 'connected' },
        { baseUrl: 'http://localhost:5173/' },
      ),
    ).toBe('http://localhost:5173/folders?view=grid&google_drive=connected');
  });

  it('builds an authorization URL with narrow Drive scope and offline access', () => {
    const { state } = createGoogleDriveOAuthState({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      returnPath: '/settings/connectors',
      now: new Date('2026-04-21T10:00:00.000Z'),
    });

    const url = new URL(buildGoogleDriveAuthorizationUrl({ config, state }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(config.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('state')).toBe(state);
  });

  it('verifies signed state and rejects tampering or expiry', () => {
    const { state } = createGoogleDriveOAuthState({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      returnPath: '/documents',
      now: new Date('2026-04-21T10:00:00.000Z'),
    });

    expect(
      verifyGoogleDriveOAuthState(state, { now: new Date('2026-04-21T10:05:00.000Z') }),
    ).toMatchObject({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      returnPath: '/documents',
    });

    expect(() => verifyGoogleDriveOAuthState(`${state.slice(0, -2)}xx`)).toThrow(
      'Invalid Google Drive OAuth state.',
    );
    expect(() =>
      verifyGoogleDriveOAuthState(state, { now: new Date('2026-04-21T10:11:00.000Z') }),
    ).toThrow('Expired Google Drive OAuth state.');
  });

  it('refreshes an access token through the Google token endpoint', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'refreshed-access-token',
          token_type: 'Bearer',
          expires_in: 1800,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const token = await refreshGoogleDriveAccessToken({
      refreshToken: 'refresh-token-1',
      config,
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('grant_type=refresh_token');
    expect(String(init?.body)).toContain('refresh_token=refresh-token-1');
    expect(token.accessToken).toBe('refreshed-access-token');
    expect(token.refreshToken).toBe('refresh-token-1');
    expect(token.scopes).toContain('https://www.googleapis.com/auth/drive.file');
  });

  it('exchanges an OAuth code through the Google token endpoint', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          id_token: 'header.payload.signature',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const token = await exchangeGoogleDriveOAuthCode({
      code: 'code-1',
      config,
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('grant_type=authorization_code');
    expect(String(init?.body)).toContain('code=code-1');
    expect(token.accessToken).toBe('access-token');
    expect(token.refreshToken).toBe('refresh-token');
    expect(token.scopes).toContain('https://www.googleapis.com/auth/drive.file');
  });
});
