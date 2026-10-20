import { expect, it } from 'vitest';
import { GatewaySessionService, type StoredState } from '../src/session-service.js';
import type { LaunchRoutingContract } from '@sentropic/llm-mesh';
const policy = (): LaunchRoutingContract => ({ version: 1, revision: 'p1', ownerScopeRef: 'owner-a',
  exactModels: ['gpt-6.1-sol'], authorizedAccountRefs: ['a'], rotateAccounts: false, effortPolicy: { mode: 'preserve' } });
it('commits trusted policy, recovers it unchanged and refuses implicit or conflicting upgrades', async () => {
  let state: StoredState = { schemaVersion: 1, revision: 0, sessions: {}, receipts: {} };
  const store = { load: async () => structuredClone(state), compareAndSet: async (_: number, next: StoredState) => { state = structuredClone(next); return { revision: next.revision }; } };
  const service = new GatewaySessionService(store);
  const input = { ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c', routingContract: policy() };
  const issued = await service.acquireSession(input);
  (input.routingContract.authorizedAccountRefs as string[])[0] = 'mutated';
  const caller = await new GatewaySessionService(store).resolveBearer(issued.key!);
  expect(caller.routingContract?.authorizedAccountRefs).toEqual(['a']);
  expect(caller.policyRevision).toBe('p1');
  await expect(service.acquireSession({ ...input, routingContract: { ...policy(), rotateAccounts: true } })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(service.acquireSession({ ...input, routingContract: policy(), models: ['other'] })).rejects.toMatchObject({ code: 'CONFLICT' });
  await service.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'legacy' });
  await expect(service.acquireSession({ ...input, clientSessionRef: 'legacy', routingContract: policy() })).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('rejects an imported key already bound to another owner', async () => {
  let state: StoredState = { schemaVersion: 1, revision: 0, sessions: {}, receipts: {} };
  const service = new GatewaySessionService({ load: async () => state, compareAndSet: async (_: number, next: StoredState) => { state = next; return { revision: next.revision }; } });
  const common = { workspaceRef: 'w', clientSessionRef: 'c', keyMaterial: 'a'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  await service.importSession({ ...common, ownerScopeRef: 'owner-a' });
  await expect(service.importSession({ ...common, ownerScopeRef: 'owner-b' })).rejects.toMatchObject({ code: 'AMBIGUOUS' });
});
