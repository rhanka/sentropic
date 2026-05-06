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

type GoogleDrivePickerConfigPayload = {
  picker: {
    client_id: string;
    developer_key: string;
    app_id: string | null;
    oauth_token: string;
    scope: string;
  };
};

type GoogleDrivePickerSelectionPayload = {
  files: Array<Record<string, unknown>>;
};

type GoogleDriveAttachPayload = {
  items: Array<Record<string, unknown>>;
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

type GoogleDriveJsonPostRequester<TResponse> = (
  path: string,
  body?: Record<string, unknown>,
) => Promise<TResponse>;

export type GoogleDrivePickerConfig = {
  clientId: string;
  developerKey: string;
  appId: string | null;
  oauthToken: string;
  scope: string;
};

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

export const fetchGoogleDrivePickerConfig = async (): Promise<GoogleDrivePickerConfig> =>
  fetchGoogleDrivePickerConfigWith((path) => apiGet<GoogleDrivePickerConfigPayload>(path));

export const fetchGoogleDrivePickerConfigWith = async (
  requester: (path: string) => Promise<GoogleDrivePickerConfigPayload>,
): Promise<GoogleDrivePickerConfig> => {
  const payload = await requester('/google-drive/picker-config');
  return {
    clientId: payload.picker.client_id,
    developerKey: payload.picker.developer_key,
    appId: payload.picker.app_id,
    oauthToken: payload.picker.oauth_token,
    scope: payload.picker.scope,
  };
};

export const resolveGoogleDrivePickerSelection = async (input: {
  fileIds: string[];
}): Promise<Array<Record<string, unknown>>> =>
  resolveGoogleDrivePickerSelectionWith(input, (path, body) =>
    apiPost<GoogleDrivePickerSelectionPayload>(path, body ?? {}),
  );

export const resolveGoogleDrivePickerSelectionWith = async (
  input: { fileIds: string[] },
  requester: GoogleDriveJsonPostRequester<GoogleDrivePickerSelectionPayload>,
): Promise<Array<Record<string, unknown>>> => {
  const payload = await requester('/google-drive/files/resolve-picker-selection', {
    file_ids: input.fileIds,
  });
  return payload.files;
};

export const attachGoogleDriveDocuments = async (input: {
  contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
  contextId: string;
  fileIds: string[];
}): Promise<Array<Record<string, unknown>>> =>
  attachGoogleDriveDocumentsWith(input, (path, body) =>
    apiPost<GoogleDriveAttachPayload>(path, body ?? {}),
  );

export const attachGoogleDriveDocumentsWith = async (
  input: {
    contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
    contextId: string;
    fileIds: string[];
  },
  requester: GoogleDriveJsonPostRequester<GoogleDriveAttachPayload>,
): Promise<Array<Record<string, unknown>>> => {
  const payload = await requester('/documents/google-drive', {
    context_type: input.contextType,
    context_id: input.contextId,
    file_ids: input.fileIds,
  });
  return payload.items;
};
