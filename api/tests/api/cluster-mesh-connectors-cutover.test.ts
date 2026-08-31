import { createConnectorAdminRouter } from '@sentropic/connector-host/hono';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../src/db/client';
import { documentConnectorAccounts } from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import { requireAdmin } from '../../src/middleware/rbac';
import { gmailRouter } from '../../src/routes/api/gmail';
import { googleDriveRouter } from '../../src/routes/api/google-drive';
import { settingsRouter } from '../../src/routes/api/settings';
import { createProductConnectorAdminRouterOptions } from '../../src/routes/namespaces/connectors';
import { storeGoogleDriveTokenMaterial } from '../../src/services/google-drive-connector-accounts';
import { GMAIL_PROVIDER } from '../../src/services/gmail-oauth';
import { settingsService } from '../../src/services/settings';
import {
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';
import { createConnectedGoogleDriveToken } from '../utils/google-drive-helper';

const mountLegacy = (): Hono => {
  const app = new Hono();
  app.use('/api/v1/google-drive/*', requireAuth);
  app.route('/api/v1/google-drive', googleDriveRouter);
  app.use('/api/v1/gmail/*', requireAuth);
  app.route('/api/v1/gmail', gmailRouter);
  app.use('/api/v1/settings/*', requireAuth, requireAdmin);
  app.route('/api/v1/settings', settingsRouter);
  return app;
};

const mountCandidate = (): Hono => {
  const app = new Hono();
  app.use('/api/v1/google-drive/*', requireAuth);
  app.use('/api/v1/gmail/*', requireAuth);
  app.use('/api/v1/settings/connector-accounts/max-per-provider', requireAuth, requireAdmin);
  app.route('/api/v1', createConnectorAdminRouter(
    createProductConnectorAdminRouterOptions(),
  ));
  return app;
};

const requestWire = async (
  app: Hono,
  user: TestUser,
  method: string,
  path: string,
  body?: unknown,
) => {
  const response = await app.request(path, {
    method,
    headers: {
      Cookie: `session=${user.sessionToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
};

describe('cluster mesh connectors pre-cutover shadow', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
    const driveToken = createConnectedGoogleDriveToken();
    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      token: driveToken,
      identity: { accountEmail: 'drive@example.com', accountSubject: 'drive-subject' },
    });
    await storeGoogleDriveTokenMaterial({
      userId: user.id,
      workspaceId: String(user.workspaceId),
      token: { ...driveToken, scope: 'https://www.googleapis.com/auth/gmail.readonly' },
      identity: { accountEmail: 'gmail@example.com', accountSubject: 'gmail-subject' },
      provider: GMAIL_PROVIDER,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (user?.id && user.workspaceId) {
      await db.delete(documentConnectorAccounts).where(and(
        eq(documentConnectorAccounts.userId, user.id),
        eq(documentConnectorAccounts.workspaceId, String(user.workspaceId)),
      ));
    }
    await cleanupAuthData();
  });

  it('keeps legacy routers live while populated account and readiness reads are byte-identical', async () => {
    expect(googleDriveRouter.routes.length).toBeGreaterThan(0);
    expect(gmailRouter.routes.length).toBeGreaterThan(0);
    const legacy = mountLegacy();
    const candidate = mountCandidate();

    for (const path of [
      '/api/v1/google-drive/connection',
      '/api/v1/gmail/connection',
    ] as const) {
      const legacyWire = await requestWire(legacy, user, 'GET', path);
      const candidateWire = await requestWire(candidate, user, 'GET', path);
      expect(legacyWire.status).toBe(200);
      expect(candidateWire).toEqual(legacyWire);
      expect(JSON.parse(candidateWire.body).account.connected).toBe(true);
    }
  });

  it('validates privileged account-limit intent without executing either author', async () => {
    const setSetting = vi.spyOn(settingsService, 'set');
    const path = '/api/v1/settings/connector-accounts/max-per-provider';
    const legacyWire = await requestWire(mountLegacy(), user, 'PUT', path, { maxPerProvider: 0 });
    const candidateWire = await requestWire(mountCandidate(), user, 'PUT', path, { maxPerProvider: 0 });

    expect(legacyWire.status).toBe(400);
    expect(candidateWire).toEqual(legacyWire);
    expect(setSetting).not.toHaveBeenCalled();
  });
});
