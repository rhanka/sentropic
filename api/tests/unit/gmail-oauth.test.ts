import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import {
  getGoogleDriveConnection,
  listConnectorAccounts,
  storeGoogleDriveTokenMaterial,
} from '../../src/services/google-drive-connector-accounts';
import { GOOGLE_DRIVE_PROVIDER } from '../../src/services/google-drive-oauth';
import {
  GMAIL_OAUTH_SCOPES,
  GMAIL_PROVIDER,
  buildGmailAuthorizationUrl,
  createGmailOAuthState,
} from '../../src/services/gmail-oauth';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';

const stateInput = { userId: 'gmail-user', workspaceId: 'gmail-workspace', returnPath: '/settings/connectors' };

const token = (accessToken: string) => ({
  accessToken,
  refreshToken: `refresh-${accessToken}`,
  idToken: null,
  tokenType: 'Bearer',
  expiresIn: 3600,
  scope: GMAIL_OAUTH_SCOPES[0],
  scopes: [...GMAIL_OAUTH_SCOPES],
  obtainedAt: '2099-05-01T10:00:00.000Z',
  expiresAt: '2099-05-01T11:00:00.000Z',
});

describe('Gmail OAuth security primitives', () => {
  it('uses only gmail.readonly and seals state with OAUTH_SIGNING_KEK', async () => {
    const { env } = await import('../../src/config/env');
    const mutable = env as typeof env & { OAUTH_SIGNING_KEK?: string };
    const saved = { kek: mutable.OAUTH_SIGNING_KEK, jwt: mutable.JWT_SECRET };
    try {
      mutable.OAUTH_SIGNING_KEK = 'gmail-state-kek';
      mutable.JWT_SECRET = 'jwt-that-must-not-seal-gmail-state';
      const { state } = createGmailOAuthState(stateInput);
      const [encodedPayload, signature] = state.split('.');
      expect(signature).toBe(
        createHmac('sha256', 'gmail-state-kek').update(encodedPayload).digest('base64url'),
      );
      expect(signature).not.toBe(
        createHmac('sha256', 'dev-secret-key-change-in-production-please')
          .update(encodedPayload).digest('base64url'),
      );

      const url = new URL(buildGmailAuthorizationUrl({
        config: {
          clientId: 'shared-google-client',
          clientSecret: 'not-exposed-to-the-url',
          redirectUri: 'https://api.example.test/api/v1/gmail/oauth/callback',
        },
        state,
      }));
      expect(url.searchParams.get('scope')).toBe(GMAIL_OAUTH_SCOPES[0]);
      expect(url.searchParams.get('scope')).not.toContain('drive.file');
      expect(url.searchParams.get('client_id')).toBe('shared-google-client');
    } finally {
      mutable.OAUTH_SIGNING_KEK = saved.kek;
      mutable.JWT_SECRET = saved.jwt;
    }
  });

  it('refuses production state sealing when neither real secret is configured', async () => {
    const { env } = await import('../../src/config/env');
    const mutable = env as typeof env & {
      OAUTH_SIGNING_KEK?: string;
      DISABLE_RATE_LIMIT?: string;
      ADMIN_EMAIL?: string;
    };
    const saved = {
      kek: mutable.OAUTH_SIGNING_KEK,
      jwt: mutable.JWT_SECRET,
      nodeEnv: mutable.NODE_ENV,
      rateLimit: mutable.DISABLE_RATE_LIMIT,
      adminEmail: mutable.ADMIN_EMAIL,
    };
    try {
      mutable.OAUTH_SIGNING_KEK = undefined;
      mutable.JWT_SECRET = undefined;
      (mutable as { NODE_ENV: string }).NODE_ENV = 'production';
      mutable.DISABLE_RATE_LIMIT = 'false';
      mutable.ADMIN_EMAIL = 'not-the-e2e-admin@example.com';
      expect(() => createGmailOAuthState(stateInput)).toThrow(/required to seal/i);
    } finally {
      mutable.OAUTH_SIGNING_KEK = saved.kek;
      mutable.JWT_SECRET = saved.jwt;
      (mutable as { NODE_ENV: string }).NODE_ENV = saved.nodeEnv;
      mutable.DISABLE_RATE_LIMIT = saved.rateLimit;
      mutable.ADMIN_EMAIL = saved.adminEmail;
    }
  });
});

describe('Gmail connector-account isolation', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (user?.id && user.workspaceId) {
      await db.delete(documentConnectorAccounts).where(and(
        eq(documentConnectorAccounts.userId, user.id),
        eq(documentConnectorAccounts.workspaceId, user.workspaceId),
      ));
    }
    await cleanupAuthData();
  });

  it('stores Gmail separately without changing the existing Drive connection', async () => {
    const input = { userId: user.id, workspaceId: String(user.workspaceId) };
    const drive = await storeGoogleDriveTokenMaterial({
      ...input,
      identity: { accountEmail: 'owner@example.test', accountSubject: 'same-google-subject' },
      token: { ...token('drive-access-token'), scope: 'https://www.googleapis.com/auth/drive.file', scopes: ['https://www.googleapis.com/auth/drive.file'] },
    });
    const driveBeforeGmail = await getGoogleDriveConnection(input);

    const gmail = await storeGoogleDriveTokenMaterial({
      ...input,
      identity: { accountEmail: 'owner@example.test', accountSubject: 'same-google-subject' },
      token: token('gmail-access-token'),
      provider: GMAIL_PROVIDER,
    });

    expect(drive.provider).toBe(GOOGLE_DRIVE_PROVIDER);
    expect(gmail.provider).toBe(GMAIL_PROVIDER);
    expect(await getGoogleDriveConnection(input)).toEqual(driveBeforeGmail);
    expect(await listConnectorAccounts(input.workspaceId, input.userId, GOOGLE_DRIVE_PROVIDER)).toHaveLength(1);
    expect(await listConnectorAccounts(input.workspaceId, input.userId, GMAIL_PROVIDER)).toHaveLength(1);
  });
});
