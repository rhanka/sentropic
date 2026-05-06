import type { GoogleDriveTokenResponse } from '../../src/services/google-drive-oauth';

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function createConnectedGoogleDriveToken(
  overrides: Partial<GoogleDriveTokenResponse> = {},
): GoogleDriveTokenResponse {
  const now = Date.now();
  return {
    accessToken: 'google-access-token',
    refreshToken: 'google-refresh-token',
    idToken: null,
    tokenType: 'Bearer',
    expiresIn: 3600,
    scope: GOOGLE_DRIVE_SCOPE,
    scopes: [GOOGLE_DRIVE_SCOPE],
    obtainedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}
