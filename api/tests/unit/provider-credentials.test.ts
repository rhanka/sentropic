import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';

import { db } from '../../src/db/client';
import { settings } from '../../src/db/schema';
import {
  buildUserProviderCredentialSettingKey,
  resolveProviderCredential,
} from '../../src/services/provider-credentials';
import { encryptSecret } from '../../src/services/secret-crypto';
import { settingsService } from '../../src/services/settings';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

describe('provider credential resolution', () => {
  const createdUserIds = new Set<string>();

  afterEach(async () => {
    const userIds = Array.from(createdUserIds);
    createdUserIds.clear();
    if (userIds.length === 0) return;
    const keys = userIds.map((userId) => buildUserProviderCredentialSettingKey('openai', userId));
    await db.delete(settings).where(inArray(settings.key, keys));
    await cleanupAuthData();
  });

  it('prefers encrypted user-scoped openai credentials over environment credentials', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const userId = user.id;
    createdUserIds.add(userId);
    const key = buildUserProviderCredentialSettingKey('openai', userId);

    await settingsService.set(
      key,
      encryptSecret('codex-derived-openai-key'),
      'test user credential',
      { userId },
    );

    const resolved = await resolveProviderCredential({
      providerId: 'openai',
      userId,
    });

    expect(resolved).toEqual({
      providerId: 'openai',
      credential: 'codex-derived-openai-key',
      source: 'user_byok',
    });
  });
});
