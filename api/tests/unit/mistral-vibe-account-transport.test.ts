import { afterEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import {
  acquireMistralVibeAccountTransport,
  getPrimaryMistralVibeAccountTransport,
  storeMistralVibeAccountTransport,
} from '../../src/services/llm-account-transports';
import { createMistralVibeAccountAuthInput } from '../../src/services/llm-runtime/mesh-dispatch';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

describe('mistral-vibe llm account transport', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('stores and acquires Mistral Vibe account transport with multi-tenant userId isolation', async () => {
    const user1 = await createAuthenticatedUser('admin_app');
    const user2 = await createAuthenticatedUser('admin_app');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await storeMistralVibeAccountTransport({
      ownerUserId: user1.id,
      externalAccountId: 'acct_vibe_testuser1',
      accountLabel: 'Vibe User 1',
      accessToken: 'vibe-access-user1',
      expiresAt,
    });

    const primary1 = await getPrimaryMistralVibeAccountTransport({ ownerUserId: user1.id });
    expect(primary1).not.toBeNull();
    expect(primary1?.transportProviderId).toBe('mistral-vibe');
    expect(primary1?.targetProviderId).toBe('mistral');

    const acqUser2 = await acquireMistralVibeAccountTransport({
      userId: user2.id,
      modelId: 'mistral-large-4',
      affinityKey: 'session:user2',
    });
    expect(acqUser2).toBeNull();

    const acqUser1 = await acquireMistralVibeAccountTransport({
      userId: user1.id,
      modelId: 'mistral-large-4',
      affinityKey: 'session:user1',
    });
    expect(acqUser1).not.toBeNull();
    expect(acqUser1?.accessToken).toBe('vibe-access-user1');
    expect(acqUser1?.transportProviderId).toBe('mistral-vibe');
  });

  it('builds mistral-vibe dispatch auth input without a refresh grant', () => {
    const auth = createMistralVibeAccountAuthInput({
      accessToken: 'vibe-access-123',
      accountId: 'acct_vibe_123',
      accountLabel: 'Vibe Label',
      stableSessionId: 'mistral_vibe:session:1',
    });

    expect(auth).toMatchObject({
      type: 'account-transport',
      provider: 'mistral-vibe',
      accessToken: 'vibe-access-123',
      accountId: 'acct_vibe_123',
      accountLabel: 'Vibe Label',
    });
    expect(auth.descriptor?.metadata?.transportSessionId).toBe('mistral_vibe:session:1');
    expect('refreshToken' in auth).toBe(false);
  });
});
