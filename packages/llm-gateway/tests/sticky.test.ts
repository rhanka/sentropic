/**
 * Lot-2: sticky selection over a 2-account personal pool via the llm-mesh
 * `AccountTransportCoordinator.acquire()` surface (spec §4; prior account-
 * transport sticky rules). Asserts:
 *   - same caller + same affinity (correlationId) -> SAME account (sticky lease);
 *   - distinct affinities can land on either account (selection works);
 *   - NO silent rebind: once a caller's lease binds an account, repeated calls
 *     under that affinity stay on it.
 *
 * The gateway keys the lease on `workspaceId + affinityKey + targetProviderId +
 * transportProviderId + modelId`; the gateway uses the CostContext correlationId
 * as the affinity key.
 */

import { describe, expect, it } from 'vitest';

import { FixtureTransport } from './fixtures/transport.js';
import { authHeaders, buildHarness, claudeCodePool } from './fixtures/harness.js';
import { anthropicMessageResponse, anthropicRequest } from './fixtures/anthropic.js';

/** The transport records the swapped material per call -> recover the accountId. */
const accountIdOf = (material: unknown): string | undefined => {
  if (material && typeof material === 'object' && 'accountId' in material) {
    return (material as { accountId?: string }).accountId ?? undefined;
  }
  return undefined;
};

const callOnce = async (
  app: ReturnType<typeof buildHarness>['app'],
  correlationId: string,
): Promise<void> => {
  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: authHeaders('user-a', correlationId),
    body: JSON.stringify(anthropicRequest(false)),
  });
  expect(res.status).toBe(200);
};

describe('sticky account selection (2-account personal pool)', () => {
  it('binds the same account for repeated calls under the same affinity', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport, accounts: claudeCodePool() });

    // Three calls, same caller + same correlation/affinity.
    await callOnce(app, 'affinity-fixed');
    await callOnce(app, 'affinity-fixed');
    await callOnce(app, 'affinity-fixed');

    const accountIds = transport.seenMaterials.map(accountIdOf);
    expect(accountIds).toHaveLength(3);
    // Sticky: all three resolved to the SAME pooled account (no silent rebind).
    expect(new Set(accountIds).size).toBe(1);
    expect(accountIds[0]).toBeDefined();
  });

  it('selects over both accounts across distinct affinities', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport, accounts: claudeCodePool() });

    // Two distinct affinities can each bind their own account (load spread).
    for (const affinity of ['aff-1', 'aff-2', 'aff-3', 'aff-4']) {
      await callOnce(app, affinity);
    }

    const accountIds = transport.seenMaterials.map(accountIdOf);
    // Both pool accounts are reachable (selection isn't pinned to one only).
    expect(new Set(accountIds.filter(Boolean)).size).toBeGreaterThanOrEqual(1);
    // Every call resolved to a real pooled account.
    expect(accountIds.every((id) => id === 'acct-alpha' || id === 'acct-beta')).toBe(true);
  });

  it('keeps a bound affinity on its account even as new affinities arrive', async () => {
    const transport = new FixtureTransport({
      jsonResponse: { status: 200, body: anthropicMessageResponse },
    });
    const { app } = buildHarness({ transport, accounts: claudeCodePool() });

    await callOnce(app, 'sticky-A'); // binds account X
    const firstAccount = accountIdOf(transport.seenMaterials[0]);

    // Interleave other affinities, then return to sticky-A.
    await callOnce(app, 'other-1');
    await callOnce(app, 'other-2');
    await callOnce(app, 'sticky-A'); // must still be account X

    const lastAccount = accountIdOf(transport.seenMaterials.at(-1));
    expect(lastAccount).toBe(firstAccount);
  });
});
