import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { sql } from 'drizzle-orm';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const VSCODE_EXTENSION_TOKEN_META_KEY = 'vscode_extension_token_meta';

describe('VSCode extension bootstrap token API', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  const originalDownloadUrl = process.env.VSCODE_EXTENSION_DOWNLOAD_URL;

  beforeEach(async () => {
    admin = await createAuthenticatedUser('admin_app');
    process.env.VSCODE_EXTENSION_DOWNLOAD_URL =
      'https://downloads.example.com/top-ai-ideas/vscode-ext.vsix';

    await db.run(
      sql`DELETE FROM settings WHERE key = ${VSCODE_EXTENSION_TOKEN_META_KEY} AND user_id IS NULL`,
    );
  });

  afterEach(async () => {
    if (originalDownloadUrl === undefined) {
      delete process.env.VSCODE_EXTENSION_DOWNLOAD_URL;
    } else {
      process.env.VSCODE_EXTENSION_DOWNLOAD_URL = originalDownloadUrl;
    }

    await db.run(
      sql`DELETE FROM settings WHERE key = ${VSCODE_EXTENSION_TOKEN_META_KEY} AND user_id IS NULL`,
    );
    await cleanupAuthData();
  });

  it('returns inactive state when no bootstrap token exists', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/settings/vscode-extension-token',
      admin.sessionToken!,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      active: false,
      meta: null,
    });
  });

  it('issues a bootstrap token and allows bearer-authenticated API access', async () => {
    const issueResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/vscode-extension-token',
      admin.sessionToken!,
    );

    expect(issueResponse.status).toBe(200);
    const issuedPayload = (await issueResponse.json()) as {
      active: boolean;
      token: string;
      meta: {
        issuedByUserId: string;
        issuedAt: string;
        expiresAt: string;
        last4: string;
        revokedAt: string | null;
      };
    };

    expect(issuedPayload.active).toBe(true);
    expect(typeof issuedPayload.token).toBe('string');
    expect(issuedPayload.token.length).toBeGreaterThan(20);
    expect(issuedPayload.meta.last4).toBe(issuedPayload.token.slice(-4));
    expect(issuedPayload.meta.issuedByUserId).toBe(admin.id);
    expect(issuedPayload.meta.revokedAt).toBeNull();

    const bearerResponse = await app.request('/api/v1/vscode-extension/download', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${issuedPayload.token}`,
      },
    });

    expect(bearerResponse.status).toBe(200);
  });

  it('revokes bootstrap token and rejects further bearer-authenticated access', async () => {
    const issueResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/vscode-extension-token',
      admin.sessionToken!,
    );
    const issuedPayload = (await issueResponse.json()) as {
      token: string;
    };

    const revokeResponse = await authenticatedRequest(
      app,
      'DELETE',
      '/api/v1/settings/vscode-extension-token',
      admin.sessionToken!,
    );
    expect(revokeResponse.status).toBe(200);
    await expect(revokeResponse.json()).resolves.toMatchObject({
      revoked: true,
      active: false,
      meta: {
        revokedAt: expect.any(String),
      },
    });

    const bearerResponse = await app.request('/api/v1/vscode-extension/download', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${issuedPayload.token}`,
      },
    });
    expect(bearerResponse.status).toBe(401);
  });
});
