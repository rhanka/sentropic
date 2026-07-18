import { describe, expect, it } from 'vitest';

import {
  AccountTransportAcquireError,
  InMemoryAccountTransportCoordinator,
  type AccountTransportAccount,
} from '../src/account-transports.js';
import { antigravityModelFleet } from '../src/providers.js';

// Regression for fix (2a): the antigravity/Google transport MUST own its own
// pool. Selection is keyed by BOTH targetProviderId AND transportProviderId, so
// a codex acquire can NEVER pick an antigravity account and vice-versa — even
// when the target provider id collides.

const antigravityAccount: AccountTransportAccount = {
  accountId: 'acct_antigravity',
  targetProviderId: 'openai', // deliberately collides with codex's target
  transportProviderId: 'antigravity',
  accessToken: 'ya29-antigravity',
  modelIds: [...antigravityModelFleet],
};

const codexAccount: AccountTransportAccount = {
  accountId: 'acct_codex',
  targetProviderId: 'openai',
  transportProviderId: 'codex',
  accessToken: 'codex-access',
  modelIds: ['gpt-5.5'],
};

describe('antigravity account pool disjointness', () => {
  it('never selects an antigravity account for a codex acquire (colliding target)', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([antigravityAccount]);
    await expect(
      coordinator.acquire({
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        modelId: 'gpt-5.5',
      }),
    ).rejects.toBeInstanceOf(AccountTransportAcquireError);
  });

  it('never selects a codex account for an antigravity acquire', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([codexAccount]);
    await expect(
      coordinator.acquire({
        targetProviderId: 'openai',
        transportProviderId: 'antigravity',
        modelId: 'gpt-oss-120b-medium',
      }),
    ).rejects.toBeInstanceOf(AccountTransportAcquireError);
  });

  it('routes each acquire to its own transport in a mixed pool', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([
      antigravityAccount,
      codexAccount,
    ]);

    const codex = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
    });
    expect(codex.material.provider).toBe('codex');
    expect(codex.material.accountId).toBe('acct_codex');

    const antigravity = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'antigravity',
      modelId: 'gemini-3-pro-high',
    });
    expect(antigravity.material.provider).toBe('antigravity');
    expect(antigravity.material.accountId).toBe('acct_antigravity');
  });

  it('a codex acquire cannot reach an antigravity-only fleet model', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([
      antigravityAccount,
      codexAccount,
    ]);
    await expect(
      coordinator.acquire({
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        modelId: 'gpt-oss-120b-medium',
      }),
    ).rejects.toBeInstanceOf(AccountTransportAcquireError);
  });
});
