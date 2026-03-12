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

  it('resolves anthropic credential from environment when no user override', async () => {
    const resolved = await resolveProviderCredential({
      providerId: 'anthropic',
    });

    // Environment credential may or may not be set in test env
    expect(resolved.providerId).toBe('anthropic');
    expect(['environment', 'none']).toContain(resolved.source);
  });

  it('resolves mistral credential from environment when no user override', async () => {
    const resolved = await resolveProviderCredential({
      providerId: 'mistral',
    });

    expect(resolved.providerId).toBe('mistral');
    expect(['environment', 'none']).toContain(resolved.source);
  });

  it('resolves cohere credential from environment when no user override', async () => {
    const resolved = await resolveProviderCredential({
      providerId: 'cohere',
    });

    expect(resolved.providerId).toBe('cohere');
    expect(['environment', 'none']).toContain(resolved.source);
  });

  it('builds correct credential setting key for new providers', () => {
    expect(buildUserProviderCredentialSettingKey('anthropic', 'user1')).toBe(
      'ai_provider_key_user:anthropic:user1',
    );
    expect(buildUserProviderCredentialSettingKey('mistral', 'user2')).toBe(
      'ai_provider_key_user:mistral:user2',
    );
    expect(buildUserProviderCredentialSettingKey('cohere', 'user3')).toBe(
      'ai_provider_key_user:cohere:user3',
    );
  });
});
