import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import {
  CONNECTOR_ACCOUNT_LIMIT_REACHED,
  disconnectGoogleDriveConnectorAccount,
  getGoogleDriveConnection,
  listConnectorAccounts,
  resolveGoogleDriveTokenSecret,
  storeGoogleDriveTokenMaterial,
} from '../../src/services/google-drive-connector-accounts';
import {
  CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING,
  settingsService,
} from '../../src/services/settings';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';

describe('Google Drive connector account storage', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (user?.id && user.workspaceId) {
      await db
        .delete(documentConnectorAccounts)
        .where(
          and(
            eq(documentConnectorAccounts.userId, user.id),
            eq(documentConnectorAccounts.workspaceId, user.workspaceId),
          ),
        );
    }
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    delete process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL;
    await settingsService.set(CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING, '5');
    vi.unstubAllGlobals();
    await cleanupAuthData();
  });

  const storeAccount = async (accountSubject: string, accessToken = `access-${accountSubject}`) =>
    storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: {
        accountEmail: `${accountSubject}@example.com`,
        accountSubject,
      },
      token: {
        accessToken,
        refreshToken: `refresh-${accountSubject}`,
        idToken: `id-${accountSubject}`,
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
        obtainedAt: '2099-05-01T10:00:00.000Z',
        expiresAt: '2099-05-01T11:00:00.000Z',
      },
    });

  it('accepts Gmail provider rows', async () => {
    const now = new Date();
    await db.insert(documentConnectorAccounts).values({
      id: crypto.randomUUID(),
      workspaceId: String(user.workspaceId),
      userId: user.id,
      provider: 'gmail',
      status: 'connected',
      accountEmail: 'gmail@example.com',
      accountSubject: 'gmail-subject-1',
      scopes: [],
      tokenSecret: null,
      tokenExpiresAt: null,
      connectedAt: now,
      disconnectedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    const accounts = await listConnectorAccounts(String(user.workspaceId), user.id, 'gmail');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.provider).toBe('gmail');
  });

  it('stores distinct accounts up to the configured maximum and rejects the next account', async () => {
    await settingsService.set(CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING, '2');

    await storeAccount('google-subject-1');
    await storeAccount('google-subject-2');

    await expect(storeAccount('google-subject-3')).rejects.toMatchObject({
      code: CONNECTOR_ACCOUNT_LIMIT_REACHED,
    });

    const accounts = await listConnectorAccounts(
      String(user.workspaceId),
      user.id,
      'google_drive',
    );
    expect(accounts.map((account) => account.accountSubject).sort()).toEqual([
      'google-subject-1',
      'google-subject-2',
    ]);
  });

  it('allows reconnecting an existing account when the configured maximum is reached', async () => {
    await settingsService.set(CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING, '1');

    await storeAccount('google-subject-1', 'initial-access-token');
    await storeAccount('google-subject-1', 'reconnected-access-token');

    const accounts = await listConnectorAccounts(
      String(user.workspaceId),
      user.id,
      'google_drive',
    );
    expect(accounts).toHaveLength(1);

    const secret = await resolveGoogleDriveTokenSecret({
      userId: user.id,
      workspaceId: String(user.workspaceId),
    });
    expect(secret?.accessToken).toBe('reconnected-access-token');

    await expect(storeAccount('google-subject-2')).rejects.toMatchObject({
      code: CONNECTOR_ACCOUNT_LIMIT_REACHED,
    });
  });

  it('refreshes an expired Google Drive access token before returning it', async () => {
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'http://localhost:8787';

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'refreshed-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: {
        accountEmail: 'user@example.com',
        accountSubject: 'google-subject-1',
      },
      token: {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
        obtainedAt: '2026-04-21T10:00:00.000Z',
        expiresAt: '2026-04-21T11:00:00.000Z',
      },
    });

    const secret = await resolveGoogleDriveTokenSecret({
      userId: user.id,
      workspaceId: String(user.workspaceId),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init?.body)).toContain('grant_type=refresh_token');
    expect(String(init?.body)).toContain('refresh_token=refresh-token');
    expect(secret?.accessToken).toBe('refreshed-access-token');
    expect(secret?.refreshToken).toBe('refresh-token');
  });

  it('surfaces refresh failures as connector errors before settings report readiness', async () => {
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'http://localhost:8787';

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: {
        accountEmail: 'user@example.com',
        accountSubject: 'google-subject-1',
      },
      token: {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
        obtainedAt: '2026-04-21T10:00:00.000Z',
        expiresAt: '2026-04-21T11:00:00.000Z',
      },
    });

    const account = await getGoogleDriveConnection(
      {
        userId: user.id,
        workspaceId: String(user.workspaceId),
      },
      { validateToken: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(account).toMatchObject({
      status: 'error',
      connected: false,
      accountEmail: 'user@example.com',
      lastError: 'Token has been expired or revoked.',
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

  it('KEEPS the refresh token when Google fails transiently (5xx), and only reports the error', async () => {
    // The grant is still valid — Google was simply unavailable. Erasing the stored secret here made
    // a momentary outage permanently destroy a working connection: refresh tokens cannot be
    // recovered, so the user had to re-authorize for nothing. Only `invalid_grant` (asserted by the
    // sibling test above) means the grant is genuinely dead.
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'http://localhost:8787';

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'backendError' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: {
        accountEmail: 'user@example.com',
        accountSubject: 'google-subject-transient',
      },
      token: {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
        obtainedAt: '2026-04-21T10:00:00.000Z',
        expiresAt: '2026-04-21T11:00:00.000Z',
      },
    });

    const account = await getGoogleDriveConnection(
      {
        userId: user.id,
        workspaceId: String(user.workspaceId),
      },
      { validateToken: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(account).toMatchObject({ status: 'error', connected: false });

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

    // The whole point: the secret SURVIVES a transient failure, still as a sealed envelope.
    expect(row.tokenSecret).not.toBeNull();
    expect(row.tokenSecret).toMatch(/^enc:/);
    expect(row.tokenSecret).not.toContain('refresh-token');
  });

  it('stores Google Drive access and refresh tokens as encrypted payloads', async () => {
    const account = await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: {
        accountEmail: 'user@example.com',
        accountSubject: 'google-subject-1',
      },
      token: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
        obtainedAt: '2099-05-01T10:00:00.000Z',
        expiresAt: '2099-05-01T11:00:00.000Z',
      },
    });

    expect(account).toMatchObject({
      status: 'connected',
      connected: true,
      accountEmail: 'user@example.com',
      accountSubject: 'google-subject-1',
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

    expect(row.tokenSecret).toMatch(/^enc:v1:/);
    expect(row.tokenSecret).not.toContain('access-token');
    expect(row.tokenSecret).not.toContain('refresh-token');

    const secret = await resolveGoogleDriveTokenSecret({
      userId: user.id,
      workspaceId: String(user.workspaceId),
    });
    expect(secret?.accessToken).toBe('access-token');
    expect(secret?.refreshToken).toBe('refresh-token');
  });

  it('REVOKES the grant upstream at Google when disconnecting, not just locally', async () => {
    // Nulling our stored copy is not revocation: the grant stays live at Google, so the user believes
    // access is gone when it is not, and any leaked copy of the token keeps working. This is the gap
    // that made "disconnect" unable to contain an exposure.
    const calls: { url: string; body: string }[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: unknown) => {
      const req = init as { body?: URLSearchParams } | undefined;
      calls.push({ url: String(url), body: req?.body ? String(req.body) : '' });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: { accountEmail: 'user@example.com', accountSubject: 'google-subject-revoke' },
      token: {
        accessToken: 'access-token', refreshToken: 'the-refresh-token', idToken: 'id-token',
        tokenType: 'Bearer', expiresIn: 3600, scope: 'openid email',
        scopes: ['openid', 'email'], obtainedAt: '2026-04-21T10:00:00.000Z',
        expiresAt: '2099-05-01T11:00:00.000Z',
      },
    });

    await disconnectGoogleDriveConnectorAccount({
      userId: user.id, workspaceId: String(user.workspaceId),
    });

    const revoke = calls.find((c) => c.url.includes('/revoke'));
    expect(revoke, 'disconnect must call Google revoke').toBeTruthy();
    // The REFRESH token, not the access token: revoking it kills the whole grant.
    expect(revoke?.body).toContain('the-refresh-token');

    const [row] = await db.select().from(documentConnectorAccounts)
      .where(and(eq(documentConnectorAccounts.userId, user.id),
        eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)))).limit(1);
    expect(row.status).toBe('disconnected');
    expect(row.tokenSecret).toBeNull();
  });

  it('still disconnects locally when upstream revocation fails', async () => {
    // The user asked to disconnect. Google being unreachable must not leave the token in our
    // database — that would be the worst of both worlds: still stored here, still live there.
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: { accountEmail: 'user@example.com', accountSubject: 'google-subject-revoke-fail' },
      token: {
        accessToken: 'access-token', refreshToken: 'the-refresh-token', idToken: 'id-token',
        tokenType: 'Bearer', expiresIn: 3600, scope: 'openid email',
        scopes: ['openid', 'email'], obtainedAt: '2026-04-21T10:00:00.000Z',
        expiresAt: '2099-05-01T11:00:00.000Z',
      },
    });

    await expect(
      disconnectGoogleDriveConnectorAccount({ userId: user.id, workspaceId: String(user.workspaceId) }),
    ).resolves.toBeTruthy();

    const [row] = await db.select().from(documentConnectorAccounts)
      .where(and(eq(documentConnectorAccounts.userId, user.id),
        eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)))).limit(1);
    expect(row.status).toBe('disconnected');
    expect(row.tokenSecret).toBeNull();
  });
});
