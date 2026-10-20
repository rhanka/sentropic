import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileGatewayStateStore } from '../src/node/gateway-state-store.js';
import { createGatewayRouteAffinityStore } from '../src/node/route-affinity-store.js';
import { GatewaySessionService } from '../src/session-service.js';
it('persists owner/policy affinity and refuses a lost pin instead of choosing another account', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-affinity-'));
  const options = { stateDir: dir, keyring: { getSecret: async () => 'a'.repeat(64) } };
  try {
    const store = new FileGatewayStateStore(options);
    const session = await new GatewaySessionService(store).acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c', models: ['gpt-6.1-sol'] });
    const key = { ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c', policyRevision: session.policyRevision };
    const affinity = createGatewayRouteAffinityStore(store);
    await affinity.compareAndSet(key, 0, { ...key, revision: 1, accountRef: 'account-a', diagnosticAccountRef: 'opaque-a', accountEpoch: 1,
      target: { providerId: 'openai', transportProviderId: 'codex', modelId: 'gpt-6.1-sol', requestedModel: 'gpt-6.1-sol', reason: 'exact' } });
    const restarted = createGatewayRouteAffinityStore(new FileGatewayStateStore(options));
    expect((await restarted.read(key))?.accountRef).toBe('account-a');
    await new GatewaySessionService(store).acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'other', models: ['gpt-6.1-sol'] });
    expect((await restarted.read(key))?.accountRef).toBe('account-a');
    expect(await restarted.read({ ...key, ownerScopeRef: 'owner-b' })).toBeNull();
    const state = await store.load();
    await store.compareAndSet(state.revision, { ...state, revision: state.revision + 1, affinities: {} });
    await expect(restarted.read(key)).rejects.toMatchObject({ code: 'no-route' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
