import { describe, expect, it } from 'vitest';

import {
  resolveDocumentSourceGoogleDriveMode,
  resolveGoogleDriveAccountLabel,
  resolveGoogleDriveConnectorCardState,
} from '../../src/lib/utils/document-source-menu';

describe('document source menu helpers', () => {
  it('marks the Google Drive source as connected when the account is connected', () => {
    expect(
      resolveDocumentSourceGoogleDriveMode({
        ready: true,
        connected: true,
        busy: false,
      }),
    ).toBe('connected');
  });

  it('keeps the Google Drive source in loading while connection state is unresolved', () => {
    expect(
      resolveDocumentSourceGoogleDriveMode({
        ready: false,
        connected: false,
        busy: false,
      }),
    ).toBe('loading');
  });

  it('routes disconnected users toward settings once connection state is known', () => {
    expect(
      resolveDocumentSourceGoogleDriveMode({
        ready: true,
        connected: false,
        busy: false,
      }),
    ).toBe('manage');
  });

  it('prefers account email over account subject for Google Drive labels', () => {
    expect(
      resolveGoogleDriveAccountLabel({
        accountEmail: 'user@example.com',
        accountSubject: 'google-subject-1',
      }),
    ).toBe('user@example.com');
  });

  it('normalizes Google Drive connector card state', () => {
    expect(
      resolveGoogleDriveConnectorCardState({
        id: 'google-account-1',
        provider: 'google_drive',
        status: 'connected',
        connected: true,
        accountEmail: null,
        accountSubject: 'google-subject-1',
        scopes: [],
        tokenExpiresAt: null,
        connectedAt: null,
        disconnectedAt: null,
        lastError: null,
        updatedAt: null,
      }),
    ).toEqual({
      connected: true,
      accountLabel: 'google-subject-1',
    });
  });
});
