import { describe, expect, it } from 'vitest';

import {
  AccountTransportAcquireError,
  InMemoryAccountTransportCoordinator,
} from '../src/account-transports.js';

const accounts = [
  {
    accountId: 'codex-a',
    accountLabel: 'Codex A',
    targetProviderId: 'openai' as const,
    transportProviderId: 'codex' as const,
    accessToken: 'token-a',
  },
  {
    accountId: 'codex-b',
    accountLabel: 'Codex B',
    targetProviderId: 'openai' as const,
    transportProviderId: 'codex' as const,
    accessToken: 'token-b',
  },
];

describe('InMemoryAccountTransportCoordinator', () => {
  it('keeps the same account and stable runtime session for an affinity key', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator(accounts);

    const first = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:abc',
      requestId: 'req_1',
      now: '2026-06-16T12:00:00.000Z',
    });
    await first.recordOutcome({ status: 'success' });

    const second = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:abc',
      requestId: 'req_2',
      now: '2026-06-16T12:01:00.000Z',
    });

    expect(second.lease.accountId).toBe(first.lease.accountId);
    expect(second.runtime.stableSessionId).toBe(first.runtime.stableSessionId);
    expect(second.descriptor).toMatchObject({
      sourceType: 'account-transport',
      accountProviderId: 'codex',
      accountId: first.lease.accountId,
    });
  });

  it('balances new sessions across accounts by current and historical load', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator(accounts);

    const first = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:a',
      requestId: 'req_a',
    });
    await first.recordOutcome({ status: 'success' });

    const second = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:b',
      requestId: 'req_b',
    });

    expect(new Set([first.lease.accountId, second.lease.accountId])).toEqual(
      new Set(['codex-a', 'codex-b']),
    );
  });

  it('marks auth-failed accounts as unavailable for later acquisitions', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([accounts[0]]);
    const first = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:a',
    });

    await first.recordOutcome({ status: 'auth_failed' });

    await expect(
      coordinator.acquire({
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        modelId: 'gpt-5.5',
        workspaceId: 'ws_1',
        affinityKey: 'chat_session:b',
      }),
    ).rejects.toBeInstanceOf(AccountTransportAcquireError);
  });
});
