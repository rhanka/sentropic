import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { settings } from '../../src/db/schema';
import {
  CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING,
  settingsService,
} from '../../src/services/settings';

describe('Settings API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await db
      .delete(settings)
      .where(
        and(
          eq(settings.key, CONNECTOR_ACCOUNTS_MAX_PER_PROVIDER_SETTING),
          isNull(settings.userId),
        ),
      );
    await cleanupAuthData();
  });

  describe('GET /settings', () => {
    it('should get all settings', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/settings', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
      expect(data).toHaveProperty('openaiModels');
      expect(data).toHaveProperty('prompts');
      expect(data).toHaveProperty('generationLimits');
    });
  });

  describe('root-mounted connector account maximum', () => {
    it('allows an admin to read and update the global maximum', async () => {
      const initialResponse = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/settings/connector-accounts/max-per-provider',
        user.sessionToken!,
      );
      expect(initialResponse.status).toBe(200);
      expect(await initialResponse.json()).toEqual({ maxPerProvider: 5 });

      const updateResponse = await authenticatedRequest(
        app,
        'PUT',
        '/api/v1/settings/connector-accounts/max-per-provider',
        user.sessionToken!,
        { maxPerProvider: 1 },
      );
      expect(updateResponse.status).toBe(200);
      expect(await updateResponse.json()).toEqual({ maxPerProvider: 1 });
      expect(await settingsService.getConnectorAccountsMaxPerProvider()).toBe(1);

      const doubled = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/connectors/settings/connector-accounts/max-per-provider',
        user.sessionToken!,
      );
      expect(doubled.status).toBe(404);
    });

    it('rejects connector account maximum changes by non-admin users', async () => {
      const editor = await createAuthenticatedUser('editor');
      const response = await authenticatedRequest(
        app,
        'PUT',
        '/api/v1/settings/connector-accounts/max-per-provider',
        editor.sessionToken!,
        { maxPerProvider: 1 },
      );

      expect(response.status).toBe(403);
    });
  });
});
