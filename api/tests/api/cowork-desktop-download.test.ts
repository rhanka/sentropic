import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { COWORK_DESKTOP_CHANNEL_KEY } from '../../src/routes/api/cowork-desktop';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

describe('Cowork desktop download metadata API', () => {
  let guest: any;
  let admin: any;

  const originalEnv = {
    downloadUrl: process.env.COWORK_DESKTOP_DOWNLOAD_URL,
    version: process.env.COWORK_DESKTOP_VERSION,
    source: process.env.COWORK_DESKTOP_SOURCE,
    prereleaseUrl: process.env.COWORK_DESKTOP_PRERELEASE_URL,
    prereleaseVersion: process.env.COWORK_DESKTOP_PRERELEASE_VERSION,
  };

  const clearChannelSetting = async () => {
    await db.run(sql`DELETE FROM settings WHERE key = ${COWORK_DESKTOP_CHANNEL_KEY} AND user_id IS NULL`);
  };

  beforeEach(async () => {
    guest = await createAuthenticatedUser('guest');
    admin = await createAuthenticatedUser('admin_app');
    delete process.env.COWORK_DESKTOP_DOWNLOAD_URL;
    delete process.env.COWORK_DESKTOP_VERSION;
    delete process.env.COWORK_DESKTOP_SOURCE;
    delete process.env.COWORK_DESKTOP_PRERELEASE_URL;
    delete process.env.COWORK_DESKTOP_PRERELEASE_VERSION;
    await clearChannelSetting();
  });

  afterEach(async () => {
    if (originalEnv.downloadUrl === undefined) delete process.env.COWORK_DESKTOP_DOWNLOAD_URL;
    else process.env.COWORK_DESKTOP_DOWNLOAD_URL = originalEnv.downloadUrl;

    if (originalEnv.version === undefined) delete process.env.COWORK_DESKTOP_VERSION;
    else process.env.COWORK_DESKTOP_VERSION = originalEnv.version;

    if (originalEnv.source === undefined) delete process.env.COWORK_DESKTOP_SOURCE;
    else process.env.COWORK_DESKTOP_SOURCE = originalEnv.source;

    if (originalEnv.prereleaseUrl === undefined) delete process.env.COWORK_DESKTOP_PRERELEASE_URL;
    else process.env.COWORK_DESKTOP_PRERELEASE_URL = originalEnv.prereleaseUrl;

    if (originalEnv.prereleaseVersion === undefined) delete process.env.COWORK_DESKTOP_PRERELEASE_VERSION;
    else process.env.COWORK_DESKTOP_PRERELEASE_VERSION = originalEnv.prereleaseVersion;

    await clearChannelSetting();
    await cleanupAuthData();
  });

  it('defaults to the release channel and serves the release URL', async () => {
    process.env.COWORK_DESKTOP_DOWNLOAD_URL = 'https://downloads.example.com/cowork/release/cowork.zip';
    process.env.COWORK_DESKTOP_VERSION = '1.0.0';
    process.env.COWORK_DESKTOP_SOURCE = 'ci:release';

    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/cowork-desktop/download',
      guest.sessionToken!
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      channel: 'release',
      downloadUrl: 'https://downloads.example.com/cowork/release/cowork.zip',
      version: '1.0.0',
      source: 'ci:release',
    });
  });

  it('returns the active channel for admins via GET /channel (default release)', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/cowork-desktop/channel',
      admin.sessionToken!
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ channel: 'release' });
  });

  it('lets an admin switch to prerelease and then serves the prerelease URL', async () => {
    process.env.COWORK_DESKTOP_DOWNLOAD_URL = 'https://downloads.example.com/cowork/release/cowork.zip';
    process.env.COWORK_DESKTOP_VERSION = '1.0.0';
    process.env.COWORK_DESKTOP_PRERELEASE_URL = 'https://downloads.example.com/cowork/prerelease/cowork.zip';
    process.env.COWORK_DESKTOP_PRERELEASE_VERSION = '1.1.0-rc.3';
    process.env.COWORK_DESKTOP_SOURCE = 'ci:build';

    const putResponse = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/cowork-desktop/channel',
      admin.sessionToken!,
      { channel: 'prerelease' }
    );
    expect(putResponse.status).toBe(200);
    await expect(putResponse.json()).resolves.toEqual({ channel: 'prerelease' });

    const downloadResponse = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/cowork-desktop/download',
      guest.sessionToken!
    );
    expect(downloadResponse.status).toBe(200);
    await expect(downloadResponse.json()).resolves.toEqual({
      channel: 'prerelease',
      downloadUrl: 'https://downloads.example.com/cowork/prerelease/cowork.zip',
      version: '1.1.0-rc.3',
      source: 'ci:build',
    });
  });

  it('rejects a channel change from a non-admin user (403)', async () => {
    const response = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/cowork-desktop/channel',
      guest.sessionToken!,
      { channel: 'prerelease' }
    );

    expect(response.status).toBe(403);
  });

  it('rejects an invalid channel value (400)', async () => {
    const response = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/cowork-desktop/channel',
      admin.sessionToken!,
      { channel: 'beta' }
    );

    expect(response.status).toBe(400);
  });

  it('returns 503 when the active prerelease channel URL is missing', async () => {
    process.env.COWORK_DESKTOP_DOWNLOAD_URL = 'https://downloads.example.com/cowork/release/cowork.zip';

    const putResponse = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/cowork-desktop/channel',
      admin.sessionToken!,
      { channel: 'prerelease' }
    );
    expect(putResponse.status).toBe(200);

    const downloadResponse = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/cowork-desktop/download',
      guest.sessionToken!
    );

    expect(downloadResponse.status).toBe(503);
    await expect(downloadResponse.json()).resolves.toEqual({
      message:
        'Cowork desktop download is unavailable: set COWORK_DESKTOP_PRERELEASE_URL in the API environment and restart the API.',
    });
  });

  it('returns 503 when the active prerelease channel URL is invalid', async () => {
    process.env.COWORK_DESKTOP_PRERELEASE_URL = 'file:///tmp/cowork.zip';

    const putResponse = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/cowork-desktop/channel',
      admin.sessionToken!,
      { channel: 'prerelease' }
    );
    expect(putResponse.status).toBe(200);

    const downloadResponse = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/cowork-desktop/download',
      guest.sessionToken!
    );

    expect(downloadResponse.status).toBe(503);
    await expect(downloadResponse.json()).resolves.toEqual({
      message:
        'Cowork desktop download is unavailable: COWORK_DESKTOP_PRERELEASE_URL must be a valid http(s) URL, then restart the API.',
    });
  });
});
