import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

const CODEX_CONNECTION_SETTINGS_KEY = 'provider_connection:codex';
const CODEX_CONNECTION_PENDING_SECRET_KEY = 'provider_connection_secret:codex_pending';
const CODEX_CONNECTION_SECRET_KEY = 'provider_connection_secret:codex';

const createJsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

describe('provider connections admin API', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let editor: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    admin = await createAuthenticatedUser('admin_app');
    editor = await createAuthenticatedUser('editor');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await db.run(
      sql`DELETE FROM settings WHERE key IN (${CODEX_CONNECTION_SETTINGS_KEY}, ${CODEX_CONNECTION_PENDING_SECRET_KEY}, ${CODEX_CONNECTION_SECRET_KEY})`,
    );
    await db.run(
      sql`DELETE FROM settings WHERE key IN (${`ai_provider_key_user:openai:${admin.userId}`}, ${`ai_provider_key_user:openai:${editor.userId}`})`,
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.run(
      sql`DELETE FROM settings WHERE key IN (${CODEX_CONNECTION_SETTINGS_KEY}, ${CODEX_CONNECTION_PENDING_SECRET_KEY}, ${CODEX_CONNECTION_SECRET_KEY})`,
    );
    await db.run(
      sql`DELETE FROM settings WHERE key IN (${`ai_provider_key_user:openai:${admin.userId}`}, ${`ai_provider_key_user:openai:${editor.userId}`})`,
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

  it('starts and completes codex enrollment in admin route, then exposes readiness only to the authenticated admin', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        device_auth_id: 'device_auth_1',
        user_code: 'ABCD-EFGH',
        interval: 1,
      }),
    );

    const startResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/provider-connections/codex/enrollment/start',
      admin.sessionToken!,
      {
        accountLabel: 'admin@example.com',
      },
    );

    expect(startResponse.status).toBe(200);
    const startPayload = (await startResponse.json()) as {
      provider: {
        providerId: string;
        ready: boolean;
        connectionStatus: string;
        enrollmentId: string | null;
        enrollmentUrl: string | null;
        enrollmentCode: string | null;
        accountLabel: string | null;
      };
    };

    expect(startPayload).toMatchObject({
      provider: {
        providerId: 'codex',
        ready: false,
        connectionStatus: 'pending',
        enrollmentUrl: 'https://auth.openai.com/codex/device',
        enrollmentCode: 'ABCD-EFGH',
        accountLabel: 'admin@example.com',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const idToken = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ email: 'admin@example.com' })).toString('base64url'),
      'signature',
    ].join('.');

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_code: 'authorization-code',
          code_verifier: 'verifier-code',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          id_token: idToken,
          access_token: 'oauth-access-token',
          refresh_token: 'refresh-token',
        }),
      );

    const completeResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/provider-connections/codex/enrollment/complete',
      admin.sessionToken!,
      {
        enrollmentId: startPayload.provider.enrollmentId,
        accountLabel: 'admin@example.com',
      },
    );

    expect(completeResponse.status).toBe(200);
    await expect(completeResponse.json()).resolves.toMatchObject({
      provider: {
        providerId: 'codex',
        ready: true,
        connectionStatus: 'connected',
        managedBy: 'admin_settings',
        accountLabel: 'admin@example.com',
        enrollmentId: null,
        enrollmentUrl: null,
        enrollmentCode: null,
      },
    });

    const adminReadiness = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/models/provider-readiness',
      admin.sessionToken!,
    );
    expect(adminReadiness.status).toBe(200);
    await expect(adminReadiness.json()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'codex',
          ready: true,
          managedBy: 'admin_settings',
          accountLabel: 'admin@example.com',
        }),
      ]),
    });

    const editorReadiness = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/models/provider-readiness',
      editor.sessionToken!,
    );
    expect(editorReadiness.status).toBe(200);
    await expect(editorReadiness.json()).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'codex',
          ready: false,
          managedBy: 'none',
          accountLabel: null,
        }),
      ]),
    });
  });

  it('disconnects codex enrollment in admin route', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        device_auth_id: 'device_auth_1',
        user_code: 'ABCD-EFGH',
        interval: 1,
      }),
    );
    const startResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/provider-connections/codex/enrollment/start',
      admin.sessionToken!,
      {
        accountLabel: 'admin@example.com',
      },
    );
    const startPayload = (await startResponse.json()) as {
      provider: { enrollmentId: string | null };
    };

    const idToken = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ email: 'admin@example.com' })).toString('base64url'),
      'signature',
    ].join('.');

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_code: 'authorization-code',
          code_verifier: 'verifier-code',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          id_token: idToken,
          access_token: 'oauth-access-token',
          refresh_token: 'refresh-token',
        }),
      );

    await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/provider-connections/codex/enrollment/complete',
      admin.sessionToken!,
      {
        enrollmentId: startPayload.provider.enrollmentId,
        accountLabel: 'admin@example.com',
      },
    );

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/provider-connections/codex/enrollment/disconnect',
      admin.sessionToken!,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: {
        providerId: 'codex',
        ready: false,
        connectionStatus: 'disconnected',
        managedBy: 'none',
        accountLabel: null,
      },
    });
  });

  it('rejects codex enrollment start for non-admin users', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/settings/provider-connections/codex/enrollment/start',
      editor.sessionToken!,
      {
        accountLabel: 'editor@example.com',
      },
    );

    expect(response.status).toBe(403);
  });
});
