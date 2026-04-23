import { describe, expect, it, vi } from 'vitest';

import {
  disconnectGoogleDriveWith,
  fetchGoogleDriveConnectionWith,
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
});
