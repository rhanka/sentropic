import { apiGet, apiPost } from './api';

export type GoogleDriveConnectionStatus = 'connected' | 'disconnected' | 'error';

export type GoogleDriveConnection = {
  id: string | null;
  provider: 'google_drive';
  status: GoogleDriveConnectionStatus;
  connected: boolean;
  accountEmail: string | null;
  accountSubject: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

type GoogleDriveConnectionPayload = {
  account: GoogleDriveConnection;
};

type GoogleDriveOAuthStartPayload = {
  authorizationUrl: string;
};

type GoogleDriveGetRequester = (path: string) => Promise<GoogleDriveConnectionPayload>;

type GoogleDriveOAuthStartRequester = (
  path: string,
  body?: Record<string, unknown>,
) => Promise<GoogleDriveOAuthStartPayload>;

type GoogleDriveConnectionPostRequester = (
  path: string,
  body?: Record<string, unknown>,
) => Promise<GoogleDriveConnectionPayload>;

export const fetchGoogleDriveConnection = async (): Promise<GoogleDriveConnection> =>
  fetchGoogleDriveConnectionWith((path) => apiGet<GoogleDriveConnectionPayload>(path));

export const fetchGoogleDriveConnectionWith = async (
  requester: GoogleDriveGetRequester,
): Promise<GoogleDriveConnection> => {
  const payload = await requester('/google-drive/connection');
  return payload.account;
};

export const startGoogleDriveOAuth = async (input: {
  returnPath?: string | null;
}): Promise<string> =>
  startGoogleDriveOAuthWith(input, (path, body) =>
    apiPost<GoogleDriveOAuthStartPayload>(path, body ?? {}),
  );

export const startGoogleDriveOAuthWith = async (
  input: {
    returnPath?: string | null;
  },
  requester: GoogleDriveOAuthStartRequester,
): Promise<string> => {
  const payload = await requester('/google-drive/oauth/start', {
    returnPath: input.returnPath ?? null,
  });
  return payload.authorizationUrl;
};

export const disconnectGoogleDrive = async (): Promise<GoogleDriveConnection> =>
  disconnectGoogleDriveWith((path, body) =>
    apiPost<GoogleDriveConnectionPayload>(path, body ?? {}),
  );

export const disconnectGoogleDriveWith = async (
  requester: GoogleDriveConnectionPostRequester,
): Promise<GoogleDriveConnection> => {
  const payload = await requester('/google-drive/disconnect', {});
  return payload.account;
};
