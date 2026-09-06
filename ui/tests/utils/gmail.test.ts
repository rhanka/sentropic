import { describe, expect, it, vi } from 'vitest';

import {
  disconnectGmailWith,
  fetchGmailConnectionWith,
  startGmailOAuthWith,
  type GmailConnection,
} from '../../src/lib/utils/gmail';

const disconnectedAccount: GmailConnection = {
  id: null,
  provider: 'gmail',
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

describe('gmail utils', () => {
  it('fetches the current Gmail connection', async () => {
    const requester = vi.fn().mockResolvedValue({ account: disconnectedAccount });

    const result = await fetchGmailConnectionWith(requester);

    expect(requester).toHaveBeenCalledWith('/gmail/connection');
    expect(requester).not.toHaveBeenCalledWith(expect.stringContaining('/connectors/'));
    expect(result).toEqual(disconnectedAccount);
  });

  it('starts Gmail OAuth with a return path', async () => {
    const requester = vi.fn().mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state_1',
    });

    const result = await startGmailOAuthWith({ returnPath: '/settings' }, requester);

    expect(requester).toHaveBeenCalledWith('/gmail/oauth/start', {
      returnPath: '/settings',
    });
    expect(result).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=state_1');
  });

  it('disconnects the current Gmail connection', async () => {
    const requester = vi.fn().mockResolvedValue({ account: disconnectedAccount });

    const result = await disconnectGmailWith(requester);

    expect(requester).toHaveBeenCalledWith('/gmail/disconnect', {});
    expect(result).toEqual(disconnectedAccount);
  });
});
