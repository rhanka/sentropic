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

  // Canonical cutover modelling: the api DB layer stores the Antigravity account
  // with targetProviderId `cloudcode-pa` (its own distinct endpoint) and
  // transportProviderId `antigravity`. Selection stays keyed by BOTH ids, so a
  // native codex/claude-code acquire can never cross into the Antigravity pool.
  const antigravityCanonical: AccountTransportAccount = {
    accountId: 'acct_antigravity_canonical',
    targetProviderId: 'cloudcode-pa',
    transportProviderId: 'antigravity',
    accessToken: 'ya29-antigravity-canonical',
    modelIds: [...antigravityModelFleet],
  };

  it('serves the whole fleet from one cloudcode-pa/antigravity account', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([antigravityCanonical]);
    for (const modelId of antigravityModelFleet) {
      const acquired = await coordinator.acquire({
        targetProviderId: 'cloudcode-pa',
        transportProviderId: 'antigravity',
        modelId,
      });
      expect(acquired.material.provider).toBe('antigravity');
      expect(acquired.material.accountId).toBe('acct_antigravity_canonical');
    }
  });

  it('never crosses a claude-code acquire into the canonical antigravity pool', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([antigravityCanonical]);
    await expect(
      coordinator.acquire({
        targetProviderId: 'anthropic',
        transportProviderId: 'claude-code',
        modelId: 'claude-sonnet-4-6',
      }),
    ).rejects.toBeInstanceOf(AccountTransportAcquireError);
  });
});
