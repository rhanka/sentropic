import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_DRIVE_PROVIDER,
  createGoogleDriveOAuthState,
  resolveCallbackBaseUrl,
  resolveClientSecret,
  resolveGoogleDriveOAuthClientId,
  verifyGoogleDriveOAuthState,
  type GoogleDriveOAuthConfig,
  type GoogleDriveOAuthStartResult,
} from './google-drive-oauth';

export const GMAIL_PROVIDER = 'gmail' as const;
export const GMAIL_OAUTH_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'] as const;

export type GoogleConnectorProvider = typeof GOOGLE_DRIVE_PROVIDER | typeof GMAIL_PROVIDER;
export type GmailOAuthConfig = GoogleDriveOAuthConfig;
export type GmailOAuthStartResult = GoogleDriveOAuthStartResult;

export const createGmailOAuthState = createGoogleDriveOAuthState;
export const verifyGmailOAuthState = verifyGoogleDriveOAuthState;

export const resolveGmailOAuthConfig = async (
  options: { requestApiBaseUrl?: string | null } = {},
): Promise<GmailOAuthConfig | null> => {
  const [clientId, clientSecret, callbackBaseUrl] = await Promise.all([
    resolveGoogleDriveOAuthClientId(),
    resolveClientSecret(),
    resolveCallbackBaseUrl(options),
  ]);
  if (!clientId || !clientSecret || !callbackBaseUrl) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: `${callbackBaseUrl}/api/v1/gmail/oauth/callback`,
  };
};

export const buildGmailAuthorizationUrl = (input: {
  config: GmailOAuthConfig;
  state: string;
}): string => {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_OAUTH_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', input.state);
  return url.toString();
};

export const startGmailOAuth = async (input: {
  userId: string;
  workspaceId: string;
  returnPath?: string | null;
  requestApiBaseUrl?: string | null;
}): Promise<GmailOAuthStartResult> => {
  const config = await resolveGmailOAuthConfig({ requestApiBaseUrl: input.requestApiBaseUrl });
  if (!config) throw new Error('Gmail OAuth is not configured.');

  const { state, payload } = createGmailOAuthState(input);
  return {
    authorizationUrl: buildGmailAuthorizationUrl({ config, state }),
    state,
    expiresAt: new Date(payload.exp).toISOString(),
  };
};
