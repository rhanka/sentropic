import { resolveGoogleDriveOAuthConfig, GOOGLE_DRIVE_OAUTH_SCOPES } from './google-drive-oauth';
import { settingsService } from './settings';

export const GOOGLE_DRIVE_PICKER_API_KEY_SETTING_KEY = 'google_drive_picker_api_key';
export const GOOGLE_DRIVE_PICKER_APP_ID_SETTING_KEY = 'google_drive_picker_app_id';

export type GoogleDrivePickerConfig = {
  clientId: string;
  developerKey: string;
  appId: string | null;
  oauthToken: string;
  scope: string;
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const deriveGoogleCloudAppId = (clientId: string): string | null => {
  const match = clientId.match(/^(\d+)-/);
  return match?.[1] ?? null;
};

async function resolveGoogleDrivePickerDeveloperKey(): Promise<string | null> {
  return (
    normalizeOptionalText(process.env.GOOGLE_DRIVE_PICKER_API_KEY) ||
    normalizeOptionalText(
      await settingsService.get(GOOGLE_DRIVE_PICKER_API_KEY_SETTING_KEY, {
        fallbackToGlobal: true,
      }),
    )
  );
}

async function resolveGoogleDrivePickerAppId(clientId: string): Promise<string | null> {
  return (
    normalizeOptionalText(process.env.GOOGLE_DRIVE_PICKER_APP_ID) ||
    normalizeOptionalText(
      await settingsService.get(GOOGLE_DRIVE_PICKER_APP_ID_SETTING_KEY, {
        fallbackToGlobal: true,
      }),
    ) ||
    deriveGoogleCloudAppId(clientId)
  );
}

export const buildGoogleDrivePickerConfig = async (input: {
  oauthToken: string;
}): Promise<GoogleDrivePickerConfig> => {
  const oauthConfig = await resolveGoogleDriveOAuthConfig();
  if (!oauthConfig?.clientId) {
    throw new Error('Google Drive Picker is not configured.');
  }

  const developerKey = await resolveGoogleDrivePickerDeveloperKey();
  if (!developerKey) {
    throw new Error('Google Drive Picker is not configured.');
  }

  return {
    clientId: oauthConfig.clientId,
    developerKey,
    appId: await resolveGoogleDrivePickerAppId(oauthConfig.clientId),
    oauthToken: input.oauthToken,
    scope:
      GOOGLE_DRIVE_OAUTH_SCOPES.find((entry) => entry.startsWith('https://www.googleapis.com/')) ??
      'https://www.googleapis.com/auth/drive.file',
  };
};
