import { describe, expect, it, vi } from 'vitest';

import {
  attachGoogleDriveDocumentsWith,
  disconnectGoogleDriveWith,
  fetchGoogleDrivePickerConfigWith,
  fetchGoogleDriveConnectionWith,
  resolveGoogleDrivePickerSelectionWith,
  startGoogleDriveOAuthWith,
  type GoogleDriveConnection,
} from '../../src/lib/utils/google-drive';

const disconnectedAccount: GoogleDriveConnection = {
  id: null,
  provider: 'google_drive',
  status: 'disconnected',
  connected: false,
  accountEmail: null,
  accountSubject: null,
  scopes: [],
  tokenExpiresAt: null,
  connectedAt: null,
  disconnectedAt: null,
  lastError: null,
  updatedAt: null,
};

describe('google drive utils', () => {
  it('fetches the current Google Drive connection', async () => {
    const requester = vi.fn().mockResolvedValue({ account: disconnectedAccount });

    const result = await fetchGoogleDriveConnectionWith(requester);

    expect(requester).toHaveBeenCalledWith('/google-drive/connection');
    expect(result).toEqual(disconnectedAccount);
  });

  it('starts Google Drive OAuth with a return path', async () => {
    const requester = vi.fn().mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state_1',
    });

    const result = await startGoogleDriveOAuthWith({ returnPath: '/chat?x=1' }, requester);

    expect(requester).toHaveBeenCalledWith('/google-drive/oauth/start', {
      returnPath: '/chat?x=1',
    });
    expect(result).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=state_1');
  });

  it('disconnects the current Google Drive connection', async () => {
    const requester = vi.fn().mockResolvedValue({ account: disconnectedAccount });

    const result = await disconnectGoogleDriveWith(requester);

    expect(requester).toHaveBeenCalledWith('/google-drive/disconnect', {});
    expect(result).toEqual(disconnectedAccount);
  });

  it('fetches picker config for the connected Google Drive account', async () => {
    const requester = vi.fn().mockResolvedValue({
      picker: {
        client_id: 'client-id-1',
        developer_key: 'picker-key-1',
        app_id: '924600787940',
        oauth_token: 'oauth-token-1',
        scope: 'https://www.googleapis.com/auth/drive.file',
      },
    });

    const result = await fetchGoogleDrivePickerConfigWith(requester);

    expect(requester).toHaveBeenCalledWith('/google-drive/picker-config');
    expect(result).toEqual({
      clientId: 'client-id-1',
      developerKey: 'picker-key-1',
      appId: '924600787940',
      oauthToken: 'oauth-token-1',
      scope: 'https://www.googleapis.com/auth/drive.file',
    });
  });

  it('resolves Google Picker selection metadata', async () => {
    const requester = vi.fn().mockResolvedValue({
      files: [{ id: 'file_1', supported: true }],
    });

    const result = await resolveGoogleDrivePickerSelectionWith(
      { fileIds: ['file_1'] },
      requester,
    );

    expect(requester).toHaveBeenCalledWith('/google-drive/files/resolve-picker-selection', {
      file_ids: ['file_1'],
    });
    expect(result).toEqual([{ id: 'file_1', supported: true }]);
  });

  it('attaches selected Google Drive files to the target context', async () => {
    const requester = vi.fn().mockResolvedValue({
      items: [{ id: 'doc_1', status: 'uploaded', job_id: 'job_1' }],
    });

    const result = await attachGoogleDriveDocumentsWith(
      {
        contextType: 'chat_session',
        contextId: 'session_1',
        fileIds: ['file_1', 'file_2'],
      },
      requester,
    );

    expect(requester).toHaveBeenCalledWith('/documents/google-drive', {
      context_type: 'chat_session',
      context_id: 'session_1',
      file_ids: ['file_1', 'file_2'],
    });
    expect(result).toEqual([{ id: 'doc_1', status: 'uploaded', job_id: 'job_1' }]);
  });
});
