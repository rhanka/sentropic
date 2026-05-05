import { afterEach, describe, expect, it } from 'vitest';
import { buildGoogleDrivePickerConfig } from '../../src/services/google-drive-picker';

describe('Google Drive Picker helpers', () => {
  const previousEnv = {
    GOOGLE_DRIVE_CLIENT_ID: process.env.GOOGLE_DRIVE_CLIENT_ID,
    GOOGLE_DRIVE_PICKER_API_KEY: process.env.GOOGLE_DRIVE_PICKER_API_KEY,
    GOOGLE_DRIVE_PICKER_APP_ID: process.env.GOOGLE_DRIVE_PICKER_APP_ID,
    GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL: process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('builds picker config without requiring a resolved OAuth callback URL', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_DRIVE_CLIENT_ID = '924600787940-test.apps.googleusercontent.com';
    process.env.GOOGLE_DRIVE_PICKER_API_KEY = 'picker-key';
    process.env.GOOGLE_DRIVE_AUTH_CALLBACK_BASE_URL = 'http://localhost:8787';
    delete process.env.GOOGLE_DRIVE_PICKER_APP_ID;

    const picker = await buildGoogleDrivePickerConfig({ oauthToken: 'oauth-token' });

    expect(picker).toMatchObject({
      clientId: '924600787940-test.apps.googleusercontent.com',
      developerKey: 'picker-key',
      appId: '924600787940',
      oauthToken: 'oauth-token',
    });
  });
});
