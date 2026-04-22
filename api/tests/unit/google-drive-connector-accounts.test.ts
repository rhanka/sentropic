import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import {
  resolveGoogleDriveTokenSecret,
  storeGoogleDriveTokenMaterial,
} from '../../src/services/google-drive-connector-accounts';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';

describe('Google Drive connector account storage', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (user?.id && user.workspaceId) {
      await db
        .delete(documentConnectorAccounts)
        .where(
          and(
            eq(documentConnectorAccounts.userId, user.id),
            eq(documentConnectorAccounts.workspaceId, user.workspaceId),
          ),
        );
    }
    await cleanupAuthData();
  });

  it('stores Google Drive access and refresh tokens as encrypted payloads', async () => {
    const account = await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      identity: {
        accountEmail: 'user@example.com',
        accountSubject: 'google-subject-1',
      },
      token: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
        obtainedAt: '2026-04-21T10:00:00.000Z',
        expiresAt: '2026-04-21T11:00:00.000Z',
      },
    });

    expect(account).toMatchObject({
      status: 'connected',
      connected: true,
      accountEmail: 'user@example.com',
      accountSubject: 'google-subject-1',
    });

    const [row] = await db
      .select()
      .from(documentConnectorAccounts)
      .where(
        and(
          eq(documentConnectorAccounts.userId, user.id),
          eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)),
        ),
      )
      .limit(1);

    expect(row.tokenSecret).toMatch(/^enc:v1:/);
    expect(row.tokenSecret).not.toContain('access-token');
    expect(row.tokenSecret).not.toContain('refresh-token');

    const secret = await resolveGoogleDriveTokenSecret({
      userId: user.id,
      workspaceId: String(user.workspaceId),
    });
    expect(secret?.accessToken).toBe('access-token');
    expect(secret?.refreshToken).toBe('refresh-token');
  });
});
