import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

describe('Chrome extension download metadata API', () => {
  let user: any;

  const originalEnv = {
    downloadUrl: process.env.CHROME_EXTENSION_DOWNLOAD_URL,
    version: process.env.CHROME_EXTENSION_VERSION,
    source: process.env.CHROME_EXTENSION_SOURCE,
  };

  beforeEach(async () => {
    user = await createAuthenticatedUser('guest');
    delete process.env.CHROME_EXTENSION_DOWNLOAD_URL;
    delete process.env.CHROME_EXTENSION_VERSION;
    delete process.env.CHROME_EXTENSION_SOURCE;
  });

  afterEach(async () => {
    if (originalEnv.downloadUrl === undefined) delete process.env.CHROME_EXTENSION_DOWNLOAD_URL;
    else process.env.CHROME_EXTENSION_DOWNLOAD_URL = originalEnv.downloadUrl;

    if (originalEnv.version === undefined) delete process.env.CHROME_EXTENSION_VERSION;
    else process.env.CHROME_EXTENSION_VERSION = originalEnv.version;

    if (originalEnv.source === undefined) delete process.env.CHROME_EXTENSION_SOURCE;
    else process.env.CHROME_EXTENSION_SOURCE = originalEnv.source;

    await cleanupAuthData();
  });

  it('returns 503 when the extension download URL and origin fallback are missing', async () => {
    const response = await authenticatedRequest(app, 'GET', '/api/v1/chrome-extension/download', user.sessionToken!);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      message:
        'Chrome extension download is unavailable: set CHROME_EXTENSION_DOWNLOAD_URL in the API environment and restart the API.',
    });
  });

  it('returns 503 when the extension download URL is invalid', async () => {
    process.env.CHROME_EXTENSION_DOWNLOAD_URL = 'file:///tmp/chrome-extension.zip';

    const response = await authenticatedRequest(app, 'GET', '/api/v1/chrome-extension/download', user.sessionToken!);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      message:
        'Chrome extension download is unavailable: CHROME_EXTENSION_DOWNLOAD_URL must be a valid http(s) URL, then restart the API.',
    });
  });

  it('returns extension download metadata when configured', async () => {
    process.env.CHROME_EXTENSION_DOWNLOAD_URL = 'https://downloads.example.com/top-ai-ideas/chrome-ext.zip';
    process.env.CHROME_EXTENSION_VERSION = '1.4.2';
    process.env.CHROME_EXTENSION_SOURCE = 'ci:build-ext';

    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/chrome-extension/download',
      user.sessionToken!,
      undefined,
      { Origin: 'https://app.example.com' }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      downloadUrl: 'https://downloads.example.com/top-ai-ideas/chrome-ext.zip',
      version: '1.4.2',
      source: 'ci:build-ext',
    });
  });

  it('returns origin-based fallback download metadata when env URL is missing', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/chrome-extension/download',
      user.sessionToken!,
      undefined,
      { Origin: 'https://dev.example.local:5173' }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      downloadUrl: 'https://dev.example.local:5173/chrome-extension/top-ai-ideas-chrome-extension.zip',
      version: '0.1.0',
      source: 'ui/chrome-ext',
    });
  });
});
