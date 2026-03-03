import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const CODEX_CONNECTION_SETTINGS_KEY = 'provider_connection:codex';

describe('provider connections admin API', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let editor: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    admin = await createAuthenticatedUser('admin_app');
    editor = await createAuthenticatedUser('editor');
    await db.run(
      sql`DELETE FROM settings WHERE key = ${CODEX_CONNECTION_SETTINGS_KEY} AND user_id IS NULL`,
    );
  });

  afterEach(async () => {
    await db.run(
      sql`DELETE FROM settings WHERE key = ${CODEX_CONNECTION_SETTINGS_KEY} AND user_id IS NULL`,
    );
    await cleanupAuthData();
  });

  it('lists provider connections for admin settings route', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/settings/provider-connections',
      admin.sessionToken!,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      providers: Array<{ providerId: string; ready: boolean }>;
    };

    expect(payload.providers.some((provider) => provider.providerId === 'codex')).toBe(
      true,
    );
    expect(payload.providers.some((provider) => provider.providerId === 'openai')).toBe(
      true,
    );
    expect(payload.providers.some((provider) => provider.providerId === 'gemini')).toBe(
      true,
    );
  });

  it('updates codex provider connection in admin route and exposes readiness to authenticated clients', async () => {
    const updateResponse = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/settings/provider-connections/codex',
      admin.sessionToken!,
      {
        connected: true,
        accountLabel: 'admin@example.com',
      },
    );

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      provider: {
        providerId: 'codex',
        ready: true,
        managedBy: 'admin_settings',
        accountLabel: 'admin@example.com',
      },
    });

    const readinessResponse = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/models/provider-readiness',
      editor.sessionToken!,
    );
    expect(readinessResponse.status).toBe(200);
    await expect(readinessResponse.json()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'codex',
          ready: true,
          managedBy: 'admin_settings',
          accountLabel: 'admin@example.com',
        }),
      ]),
    });
  });

  it('rejects codex provider connection updates for non-admin users', async () => {
    const response = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/settings/provider-connections/codex',
      editor.sessionToken!,
      {
        connected: true,
      },
    );

    expect(response.status).toBe(403);
  });
});
