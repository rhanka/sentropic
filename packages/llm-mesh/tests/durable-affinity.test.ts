import { expect, it } from 'vitest';
import { InMemoryRoutePlanner } from '../src/route-planner.js';
import { routeAffinityRef, type RouteAffinityRecord, type RouteAffinityStore } from '../src/ports/route-affinity-store.js';
import { freezeLaunchRoutingContract } from '../src/launch-routing-contract.js';
import { FakeRouteDirectory, routingSubject } from './fixtures/route-planner.js';
const contract = (rotateAccounts = false) => freezeLaunchRoutingContract({ version: 1, revision: 'p1', ownerScopeRef: 'user-a',
  exactModels: ['gemini-3.5-flash'], authorizedAccountRefs: ['internal-old', 'internal-new'], rotateAccounts, effortPolicy: { mode: 'preserve' } });
const fixture = () => {
  const rows = new Map<string, RouteAffinityRecord>();
  const store: RouteAffinityStore = { async read(key) { return structuredClone(rows.get(routeAffinityRef(key)) ?? null); },
    async compareAndSet(key, revision, next) {
      if ((rows.get(routeAffinityRef(key))?.revision ?? 0) !== revision) throw new Error('conflict');
      rows.set(routeAffinityRef(key), structuredClone(next));
    } };
  const directory = new FakeRouteDirectory();
  return { rows, directory, planner: () => new InMemoryRoutePlanner({ directory, affinityStore: store, maximumAffinityEntries: 1 }) };
};
const request = (client: string, rotate = false) => ({ requestedModel: 'gemini-3.5-flash', affinityKey: client,
  workspaceId: 'w', launchRoutingContract: contract(rotate) });
it('retains separate A/B pins across restart and memory eviction, and refuses a deleted account', async () => {
  const f = fixture(); const planner = f.planner();
  for (let i = 0; i < 15; i += 1) {
    await planner.plan(routingSubject(), { ...request(`client-${i}`), explicit: { diagnosticAccountRef: i % 2 ? 'acct_new' : 'acct_old' } });
  }
  const restarted = f.planner();
  expect((await restarted.plan(routingSubject(), request('client-0'))).diagnostics[0]?.diagnosticAccountRef).toBe('acct_old');
  expect((await restarted.plan(routingSubject(), request('client-1'))).diagnostics[0]?.diagnosticAccountRef).toBe('acct_new');
  f.directory.accounts.splice(0, 1);
  await expect(f.planner().plan(routingSubject(), request('client-0'))).rejects.toMatchObject({ code: 'no-route' });
  expect(f.directory.prepared).toHaveLength(0);
});
it('persists a consented pre-commit rotation and increments the account epoch', async () => {
  const f = fixture(); const planner = f.planner();
  const plan = await planner.plan(routingSubject(), request('rotating', true));
  const first = await planner.prepareAttempt(routingSubject(), plan.planRef, plan.candidateRefs[0]!, 'r', 0);
  await first.recordOutcome({ reason: 'rate-limited', healthScope: 'provider-model', retryable: true, committed: false });
  const second = await planner.prepareAttempt(routingSubject(), plan.planRef, plan.candidateRefs[1]!, 'r', 1);
  await second.markCommitted(); await second.complete();
  expect((await f.planner().plan(routingSubject(), request('rotating', true))).diagnostics[0]?.diagnosticAccountRef).toBe('acct_old');
  expect([...f.rows.values()][0]?.accountEpoch).toBe(2);
});
it('refuses unreadable durable state before preparing a provider', async () => {
  const directory = new FakeRouteDirectory();
  const planner = new InMemoryRoutePlanner({ directory, affinityStore: { async read() { throw new Error('protected state unavailable'); }, async compareAndSet() {} } });
  await expect(planner.plan(routingSubject(), request('closed'))).rejects.toThrow('protected state unavailable');
  expect(directory.prepared).toHaveLength(0);
});
