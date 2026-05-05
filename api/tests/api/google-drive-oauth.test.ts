import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import { googleDriveRouter } from '../../src/routes/api/google-drive';
import {
  GOOGLE_DRIVE_OAUTH_CALLBACK_BASE_URL_SETTING_KEY,
  GOOGLE_DRIVE_OAUTH_CLIENT_ID_SETTING_KEY,
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET_SETTING_KEY,
  verifyGoogleDriveOAuthState,
} from '../../src/services/google-drive-oauth';
import { resolveGoogleDriveTokenSecret } from '../../src/services/google-drive-connector-accounts';
import { settingsService } from '../../src/services/settings';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';

function encodeJwtPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    'signature',
  ].join('.');
}

async function createMountedGoogleDriveApp() {
  const app = new Hono();
  app.use('/api/v1/google-drive/*', requireAuth);
  app.route('/api/v1/google-drive', googleDriveRouter);
  return app;
}

async function seedGoogleDriveOAuthConfig() {
  await settingsService.set(
    GOOGLE_DRIVE_OAUTH_CLIENT_ID_SETTING_KEY,
    'test-google-client-id',
    'Google Drive test client id',
  );
  await settingsService.set(
    GOOGLE_DRIVE_OAUTH_CLIENT_SECRET_SETTING_KEY,
    'test-google-client-secret',
    'Google Drive test client secret',
  );
  await settingsService.set(
    GOOGLE_DRIVE_OAUTH_CALLBACK_BASE_URL_SETTING_KEY,
    'https://api.example.test',
    'Google Drive test callback base URL',
  );
}

describe('Google Drive OAuth API router', () => {
  let app: Hono;
  let user: TestUser;
  let previousGoogleDriveEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    previousGoogleDriveEnv = {
      GOOGLE_DRIVE_CLIENT_ID: process.env.GOOGLE_DRIVE_CLIENT_ID,
      GOOGLE_DRIVE_CLIENT_SECRET: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
      GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL: process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL,
      AUTH_CALLBACK_BASE_URL: process.env.AUTH_CALLBACK_BASE_URL,
    };
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'https://api.example.test';
    process.env.AUTH_CALLBACK_BASE_URL = 'https://app.example.test';
    app = await createMountedGoogleDriveApp();
    user = await createAuthenticatedUser('editor');
    await seedGoogleDriveOAuthConfig();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    if (user?.id && user?.workspaceId) {
      await db
        .delete(documentConnectorAccounts)
        .where(
          and(
            eq(documentConnectorAccounts.userId, user.id),
            eq(documentConnectorAccounts.workspaceId, user.workspaceId),
          ),
        );
    }
    await db.run(sql`
      DELETE FROM settings
      WHERE key IN (
        ${GOOGLE_DRIVE_OAUTH_CLIENT_ID_SETTING_KEY},
        ${GOOGLE_DRIVE_OAUTH_CLIENT_SECRET_SETTING_KEY},
        ${GOOGLE_DRIVE_OAUTH_CALLBACK_BASE_URL_SETTING_KEY}
      )
      AND user_id IS NULL
    `);
    for (const [key, value] of Object.entries(previousGoogleDriveEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.unstubAllGlobals();
    await cleanupAuthData();
  });

  it('returns disconnected status before a Google account is connected', async () => {
    const res = await app.request('/api/v1/google-drive/connection', {
      method: 'GET',
      headers: { Cookie: `session=${user.sessionToken}` },
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.account).toMatchObject({
      provider: 'google_drive',
      status: 'disconnected',
      connected: false,
      accountEmail: null,
    });
  });

  it('starts OAuth with signed state scoped to the current user and workspace', async () => {
    const res = await app.request('/api/v1/google-drive/oauth/start', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ returnPath: '/settings/connectors' }),
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    const url = new URL(payload.authorizationUrl);
    const state = String(url.searchParams.get('state'));
    const verified = verifyGoogleDriveOAuthState(state);
    expect(verified).toMatchObject({
      userId: user.id,
      workspaceId: user.workspaceId,
      returnPath: '/settings/connectors',
    });
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.test/api/v1/google-drive/oauth/callback',
    );
  });

  it('uses the public API origin from forwarded headers when production callback config is loopback', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'http://localhost:8787';
    await settingsService.set(
      GOOGLE_DRIVE_OAUTH_CALLBACK_BASE_URL_SETTING_KEY,
      'http://localhost:8787',
      'Google Drive loopback callback base URL',
    );

    try {
      const res = await app.request('/api/v1/google-drive/oauth/start', {
        method: 'POST',
        headers: {
          Cookie: `session=${user.sessionToken}`,
          'Content-Type': 'application/json',
          'x-forwarded-host': 'top-ai-ideas-api.sent-tech.ca',
          'x-forwarded-proto': 'https',
        },
        body: JSON.stringify({ returnPath: '/settings/connectors' }),
      });

      expect(res.status).toBe(200);
      const payload = await res.json();
      const url = new URL(payload.authorizationUrl);
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://top-ai-ideas-api.sent-tech.ca/api/v1/google-drive/oauth/callback',
      );
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it('rejects callback state that does not validate', async () => {
    const res = await app.request(
      '/api/v1/google-drive/oauth/callback?format=json&state=invalid&code=code-1',
      {
        method: 'GET',
        headers: {
          Cookie: `session=${user.sessionToken}`,
          Accept: 'application/json',
        },
      },
    );

    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.message).toContain('Invalid Google Drive OAuth state');
  });

  it('completes OAuth callback and stores token material encrypted', async () => {
    const idToken = encodeJwtPayload({
      sub: 'google-subject-1',
      email: 'user@example.com',
    });
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'google-access-token',
          refresh_token: 'google-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          id_token: idToken,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const start = await app.request('/api/v1/google-drive/oauth/start', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ returnPath: '/documents' }),
    });
    const startPayload = await start.json();
    const state = new URL(startPayload.authorizationUrl).searchParams.get('state');

    const callback = await app.request(
      `/api/v1/google-drive/oauth/callback?format=json&state=${encodeURIComponent(String(state))}&code=google-code`,
      {
        method: 'GET',
        headers: {
          Cookie: `session=${user.sessionToken}`,
          Accept: 'application/json',
        },
      },
    );

    expect(callback.status).toBe(200);
    const payload = await callback.json();
    expect(payload.account).toMatchObject({
      provider: 'google_drive',
      status: 'connected',
      connected: true,
      accountEmail: 'user@example.com',
      accountSubject: 'google-subject-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(documentConnectorAccounts)
      .where(
        and(
          eq(documentConnectorAccounts.userId, user.id),
          eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)),
        ),
      )
      .limit(1);
    expect(row.tokenSecret).toMatch(/^enc:v1:/);
    expect(row.tokenSecret).not.toContain('google-access-token');

    const token = await resolveGoogleDriveTokenSecret({
      userId: user.id,
      workspaceId: String(user.workspaceId),
    });
    expect(token?.accessToken).toBe('google-access-token');
    expect(token?.refreshToken).toBe('google-refresh-token');
  });

  it('redirects OAuth callback completions back to the frontend origin', async () => {
    const idToken = encodeJwtPayload({
      sub: 'google-subject-2',
      email: 'redirect@example.com',
    });
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'google-access-token-2',
          refresh_token: 'google-refresh-token-2',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          id_token: idToken,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const start = await app.request('/api/v1/google-drive/oauth/start', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ returnPath: '/folders?view=grid' }),
    });
    const startPayload = await start.json();
    const state = new URL(startPayload.authorizationUrl).searchParams.get('state');

    const callback = await app.request(
      `/api/v1/google-drive/oauth/callback?state=${encodeURIComponent(String(state))}&code=google-code`,
      {
        method: 'GET',
        headers: {
          Cookie: `session=${user.sessionToken}`,
        },
        redirect: 'manual',
      },
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(
      'https://app.example.test/folders?view=grid&google_drive=connected',
    );
  });

  it('disconnects an existing Google Drive account and clears encrypted tokens', async () => {
    await db.insert(documentConnectorAccounts).values({
      id: crypto.randomUUID(),
      workspaceId: String(user.workspaceId),
      userId: user.id,
      provider: 'google_drive',
      status: 'connected',
      accountEmail: 'user@example.com',
      accountSubject: 'google-subject-1',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      tokenSecret: 'enc:v1:test',
      tokenExpiresAt: new Date('2026-04-21T11:00:00.000Z'),
      connectedAt: new Date('2026-04-21T10:00:00.000Z'),
      createdAt: new Date('2026-04-21T10:00:00.000Z'),
      updatedAt: new Date('2026-04-21T10:00:00.000Z'),
    });

    const res = await app.request('/api/v1/google-drive/disconnect', {
      method: 'POST',
      headers: { Cookie: `session=${user.sessionToken}` },
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.account).toMatchObject({
      status: 'disconnected',
      connected: false,
    });

    const [row] = await db
      .select()
      .from(documentConnectorAccounts)
      .where(
        and(
          eq(documentConnectorAccounts.userId, user.id),
          eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)),
        ),
      )
      .limit(1);
    expect(row.tokenSecret).toBeNull();
    expect(row.tokenExpiresAt).toBeNull();
  });
});
