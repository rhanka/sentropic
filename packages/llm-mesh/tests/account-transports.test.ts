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

  it('selects the most recently enrolled eligible account for a new affinity', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([
      { ...accounts[0], priority: 100, enrollmentCompletedAt: '2026-08-01T00:00:00Z' },
      { ...accounts[1], priority: 0, enrollmentCompletedAt: '2026-08-02T00:00:00Z' },
    ]);

    const acquisition = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      affinityKey: 'new-session',
      now: '2026-08-03T00:00:00Z',
    });

    expect(acquisition.lease.accountId).toBe('codex-b');
  });

  it('acquires only the exact mesh-planned account and releases without health impact', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator(accounts);
    const acquisition = await coordinator.acquire({
      accountId: 'codex-a', targetProviderId: 'openai', transportProviderId: 'codex',
      modelId: 'gpt-5.5', requestId: 'planned-attempt',
    });

    expect(acquisition.lease.accountId).toBe('codex-a');
    await acquisition.release?.();
    await acquisition.release?.();
    await expect(coordinator.acquire({
      accountId: 'codex-a', targetProviderId: 'openai', transportProviderId: 'codex',
      modelId: 'gpt-5.5', requestId: 'next-attempt',
    })).resolves.toMatchObject({ lease: { accountId: 'codex-a' } });
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

  it('auto-recovers a rate-limited account after cooldown expires', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator([accounts[0]]);

    const first = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:a',
      requestId: 'req_1',
      now: '2026-06-16T12:00:00.000Z',
    });

    // Record rate_limited with a 5-second cooldown
    await first.recordOutcome({
      status: 'rate_limited',
      retryAfterMs: 5000,
      finishedAt: '2026-06-16T12:00:00.000Z',
    });

    // During cooldown: no eligible account
    await expect(
      coordinator.acquire({
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        modelId: 'gpt-5.5',
        workspaceId: 'ws_1',
        affinityKey: 'chat_session:b',
        requestId: 'req_2',
        now: '2026-06-16T12:00:03.000Z', // 3s later, still in cooldown
      }),
    ).rejects.toBeInstanceOf(AccountTransportAcquireError);

    // After cooldown: account recovers
    const recovered = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:c',
      requestId: 'req_3',
      now: '2026-06-16T12:00:06.000Z', // 6s later, cooldown expired
    });

    expect(recovered.lease.accountId).toBe('codex-a');
  });

  it('rotates to next account when one is rate-limited', async () => {
    const coordinator = new InMemoryAccountTransportCoordinator(accounts);

    const first = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:a',
      requestId: 'req_1',
      now: '2026-06-16T12:00:00.000Z',
    });

    await first.recordOutcome({
      status: 'rate_limited',
      retryAfterMs: 60000,
      finishedAt: '2026-06-16T12:00:00.000Z',
    });

    // Next acquire should get a different account (rotation)
    const second = await coordinator.acquire({
      targetProviderId: 'openai',
      transportProviderId: 'codex',
      modelId: 'gpt-5.5',
      workspaceId: 'ws_1',
      affinityKey: 'chat_session:b',
      requestId: 'req_2',
      now: '2026-06-16T12:00:01.000Z',
    });

    expect(second.lease.accountId).not.toBe(first.lease.accountId);
  });
});
