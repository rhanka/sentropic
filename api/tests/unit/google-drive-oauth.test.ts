import { describe, expect, it, vi } from 'vitest';
import {
  appendGoogleDriveOAuthResultToReturnPath,
  buildGoogleDriveAuthorizationUrl,
  createGoogleDriveOAuthState,
  exchangeGoogleDriveOAuthCode,
  refreshGoogleDriveAccessToken,
  resolveGoogleDriveOAuthConfig,
  resolveGoogleDriveAppReturnBaseUrl,
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

  it('derives the public app return base URL from the current sent-tech API host', () => {
    const previous = process.env.AUTH_CALLBACK_BASE_URL;
    delete process.env.AUTH_CALLBACK_BASE_URL;
    try {
      expect(
        resolveGoogleDriveAppReturnBaseUrl({
          requestApiBaseUrl: 'https://sentropic.sent-tech.ca',
        }),
      ).toBe('https://sentropic.sent-tech.ca');
    } finally {
      if (previous === undefined) {
        delete process.env.AUTH_CALLBACK_BASE_URL;
      } else {
        process.env.AUTH_CALLBACK_BASE_URL = previous;
      }
    }
  });

  it('ignores loopback app return config when the current API host is public', () => {
    const previous = process.env.AUTH_CALLBACK_BASE_URL;
    process.env.AUTH_CALLBACK_BASE_URL = 'http://localhost:5173';
    try {
      expect(
        resolveGoogleDriveAppReturnBaseUrl({
          requestApiBaseUrl: 'https://sentropic.sent-tech.ca',
        }),
      ).toBe('https://sentropic.sent-tech.ca');
    } finally {
      if (previous === undefined) {
        delete process.env.AUTH_CALLBACK_BASE_URL;
      } else {
        process.env.AUTH_CALLBACK_BASE_URL = previous;
      }
    }
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

  it('ignores loopback callback configuration in production when the request API base URL is available', async () => {
    const previousEnv = {
      NODE_ENV: process.env.NODE_ENV,
      GOOGLE_DRIVE_CLIENT_ID: process.env.GOOGLE_DRIVE_CLIENT_ID,
      GOOGLE_DRIVE_CLIENT_SECRET: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
      GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL: process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL,
      AUTH_CALLBACK_BASE_URL: process.env.AUTH_CALLBACK_BASE_URL,
    };
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'http://localhost:8787';
    process.env.AUTH_CALLBACK_BASE_URL = 'https://app.example.test';

    try {
      const resolved = await resolveGoogleDriveOAuthConfig({
        requestApiBaseUrl: 'https://sentropic.sent-tech.ca',
      });

      expect(resolved?.redirectUri).toBe(
        'https://sentropic.sent-tech.ca/api/v1/google-drive/oauth/callback',
      );
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
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

describe('Google Drive OAuth state sealing key', () => {
  const stateInput = { userId: 'u1', workspaceId: 'w1', returnPath: '/documents' };

  it('REFUSES the public literal in production instead of sealing with it', async () => {
    // Deployed containers receive no JWT_SECRET, so this used to seal production state with a constant
    // that is readable in a public repository — integrity resting on a value anyone can look up.
    // Sealing with a public constant is indistinguishable from not sealing at all, so refusing to
    // operate is the correct outcome; a fallback that is only wrong in production is the kind that
    // survives every review.
    const { env } = await import('../../src/config/env');
    const mutable = env as typeof env & {
      OAUTH_SIGNING_KEK?: string;
      DISABLE_RATE_LIMIT?: string;
      ADMIN_EMAIL?: string;
    };
    const saved = {
      kek: mutable.OAUTH_SIGNING_KEK,
      jwt: mutable.JWT_SECRET,
      nodeEnv: mutable.NODE_ENV,
      rateLimit: mutable.DISABLE_RATE_LIMIT,
      adminEmail: mutable.ADMIN_EMAIL,
    };
    try {
      mutable.OAUTH_SIGNING_KEK = undefined;
      mutable.JWT_SECRET = undefined;
      (mutable as { NODE_ENV: string }).NODE_ENV = 'production';
      // `requiresOAuthProductionSecrets` is switched OFF by `isE2eProductionImageRuntime`, which is
      // true when NODE_ENV=production AND DISABLE_RATE_LIMIT='true' AND ADMIN_EMAIL is the e2e admin.
      // CI sets those last two, so merely forcing NODE_ENV would satisfy that escape hatch and
      // silently disable the very guard under test — the test would then pass locally and fail in CI
      // for reasons having nothing to do with the code. Pin all three inputs.
      mutable.DISABLE_RATE_LIMIT = 'false';
      mutable.ADMIN_EMAIL = 'not-the-e2e-admin@example.com';
      expect(() => createGoogleDriveOAuthState(stateInput)).toThrow(/required to seal/i);
    } finally {
      mutable.OAUTH_SIGNING_KEK = saved.kek;
      mutable.JWT_SECRET = saved.jwt;
      (mutable as { NODE_ENV: string }).NODE_ENV = saved.nodeEnv;
      mutable.DISABLE_RATE_LIMIT = saved.rateLimit;
      mutable.ADMIN_EMAIL = saved.adminEmail;
    }
  });

  it('prefers OAUTH_SIGNING_KEK over JWT_SECRET, so provisioning JWT_SECRET cannot move the key', async () => {
    // Same precedence as the IdP state sealer. Both seal OAuth state; they must not drift onto
    // different keys, and a later JWT_SECRET rollout must not silently re-key either of them.
    const { env } = await import('../../src/config/env');
    const mutable = env as typeof env & { OAUTH_SIGNING_KEK?: string };
    const kek = mutable.OAUTH_SIGNING_KEK;
    const jwt = mutable.JWT_SECRET;
    try {
      mutable.OAUTH_SIGNING_KEK = 'the-kek-value';
      mutable.JWT_SECRET = undefined;
      const sealed = createGoogleDriveOAuthState(stateInput);

      // Introducing JWT_SECRET afterwards must NOT invalidate state sealed under the KEK.
      mutable.JWT_SECRET = 'a-freshly-provisioned-jwt-secret';
      expect(verifyGoogleDriveOAuthState(sealed.state)).toMatchObject({ userId: 'u1' });
    } finally {
      mutable.OAUTH_SIGNING_KEK = kek;
      mutable.JWT_SECRET = jwt;
    }
  });

  it('treats an EMPTY key as absent rather than sealing with an empty string', async () => {
    // The secret bundle emits present-but-empty values; `||` must fall through where `??` would not.
    const { env } = await import('../../src/config/env');
    const mutable = env as typeof env & { OAUTH_SIGNING_KEK?: string };
    const kek = mutable.OAUTH_SIGNING_KEK;
    const jwt = mutable.JWT_SECRET;
    try {
      mutable.OAUTH_SIGNING_KEK = '';
      mutable.JWT_SECRET = 'the-jwt-value';
      const sealed = createGoogleDriveOAuthState(stateInput);
      expect(verifyGoogleDriveOAuthState(sealed.state)).toMatchObject({ userId: 'u1' });
    } finally {
      mutable.OAUTH_SIGNING_KEK = kek;
      mutable.JWT_SECRET = jwt;
    }
  });
});
