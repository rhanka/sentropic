import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import { googleDriveRouter } from '../../src/routes/api/google-drive';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import { GOOGLE_WORKSPACE_MIME_TYPES } from '../../src/services/google-drive-client';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';
import { createConnectedGoogleDriveToken } from '../utils/google-drive-helper';

async function createMountedGoogleDriveApp() {
  const app = new Hono();
  app.use('/api/v1/google-drive/*', requireAuth);
  app.route('/api/v1/google-drive', googleDriveRouter);
  return app;
}

const seedConnectedGoogleDriveAccount = (user: TestUser) =>
  storeGoogleDriveTokenMaterial({
    userId: user.id,
    workspaceId: String(user.workspaceId),
    token: createConnectedGoogleDriveToken(),
    identity: {
      accountEmail: 'user@example.com',
      accountSubject: 'google-subject-1',
    },
  });

describe('Google Drive file selection API', () => {
  let app: Hono;
  let user: TestUser;
  const originalPickerApiKey = process.env.GOOGLE_DRIVE_PICKER_API_KEY;
  const originalClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const originalCallbackBaseUrl = process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL;

  beforeEach(async () => {
    app = await createMountedGoogleDriveApp();
    user = await createAuthenticatedUser('editor');
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    if (user?.id && user?.workspaceId) {
      await db
        .delete(documentConnectorAccounts)
        .where(
          and(
            eq(documentConnectorAccounts.userId, user.id),
            eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)),
          ),
        );
    }
    process.env.GOOGLE_DRIVE_PICKER_API_KEY = originalPickerApiKey;
    process.env.GOOGLE_DRIVE_CLIENT_ID = originalClientId;
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = originalClientSecret;
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = originalCallbackBaseUrl;
    vi.unstubAllGlobals();
    await cleanupAuthData();
  });

  it('returns picker config for a connected Google Drive account', async () => {
    await seedConnectedGoogleDriveAccount(user);
    process.env.GOOGLE_DRIVE_PICKER_API_KEY = 'picker-key-123';
    process.env.GOOGLE_DRIVE_CLIENT_ID =
      '924600787940-bc4tfvq52lseekjr090ic2e6k4gl4r8f.apps.googleusercontent.com';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'picker-client-secret';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'http://localhost:9080';

    const res = await app.request('/api/v1/google-drive/picker-config', {
      method: 'GET',
      headers: {
        Cookie: `session=${user.sessionToken}`,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      picker: {
        client_id:
          '924600787940-bc4tfvq52lseekjr090ic2e6k4gl4r8f.apps.googleusercontent.com',
        developer_key: 'picker-key-123',
        app_id: '924600787940',
        oauth_token: 'google-access-token',
        scope: 'https://www.googleapis.com/auth/drive.file',
      },
    });
  });

  it('rejects picker selection resolution when Google Drive is disconnected', async () => {
    const res = await app.request('/api/v1/google-drive/files/resolve-picker-selection', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_ids: ['file_1'] }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Google Drive account is not connected',
    });
  });

  it('resolves selected Google Drive file metadata and support status', async () => {
    await seedConnectedGoogleDriveAccount(user);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'file_1',
          name: 'Roadmap',
          mimeType: GOOGLE_WORKSPACE_MIME_TYPES.document,
          webViewLink: 'https://docs.google.com/document/d/file_1',
          modifiedTime: '2026-04-22T12:00:00.000Z',
          version: '42',
          trashed: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/api/v1/google-drive/files/resolve-picker-selection', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_ids: ['file_1'] }),
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]).toMatchObject({
      id: 'file_1',
      name: 'Roadmap',
      mime_type: GOOGLE_WORKSPACE_MIME_TYPES.document,
      supported: true,
      export_mime_type: 'text/markdown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/drive/v3/files/file_1?');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer google-access-token',
    );
  });

  it('returns unsupported files without attaching them', async () => {
    await seedConnectedGoogleDriveAccount(user);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'folder_1',
            name: 'Drive Folder',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const res = await app.request('/api/v1/google-drive/files/resolve-picker-selection', {
      method: 'POST',
      headers: {
        Cookie: `session=${user.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_ids: ['folder_1'] }),
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.files[0]).toMatchObject({
      id: 'folder_1',
      supported: false,
      export_mime_type: null,
    });
  });
});
