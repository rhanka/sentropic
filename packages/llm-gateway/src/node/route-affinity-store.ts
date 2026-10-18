import { routeAffinityRef, RoutePlanError, type RouteAffinityKey, type RouteAffinityStore } from '@sentropic/llm-mesh';
import { GatewayStateError, runGatewayStateTransaction, type GatewayStateStore, type StoredState } from '../ports/gateway-state.js';
const sessionFor = (state: StoredState, key: RouteAffinityKey) => Object.values(state.sessions).find((session) =>
  session.ownerScopeRef === key.ownerScopeRef && session.workspaceRef === key.workspaceRef
  && session.clientSessionRef === key.clientSessionRef && session.policyRevision === key.policyRevision);

/** Storage binding only: mesh owns selection, account epochs and routing semantics. */
export const createGatewayRouteAffinityStore = (store: GatewayStateStore): RouteAffinityStore => ({
  async read(key) {
    const state = await store.load();
    const row = state.affinities?.[routeAffinityRef(key)];
    if (!row && sessionFor(state, key)?.affinityRequired) throw new RoutePlanError('Required durable affinity is unavailable', 'no-route');
    if (row && (routeAffinityRef(row) !== routeAffinityRef(key) || !Number.isSafeInteger(row.revision) || row.revision < 1)) {
      throw new GatewayStateError('durable affinity corrupt', 'CORRUPT');
    }
    return row ? structuredClone(row) : null;
  },
  async compareAndSet(key, expectedRevision, next) {
    if (routeAffinityRef(key) !== routeAffinityRef(next) || next.revision !== expectedRevision + 1) throw new RoutePlanError('Affinity revision changed', 'conflict');
    try {
      await runGatewayStateTransaction(store, async () => {
        const state = await store.load();
        const ref = routeAffinityRef(key);
        if ((state.affinities?.[ref]?.revision ?? 0) !== expectedRevision) throw new RoutePlanError('Affinity revision changed', 'conflict');
        const session = sessionFor(state, key);
        if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) throw new RoutePlanError('Affinity session is unavailable', 'no-route');
        await store.compareAndSet(state.revision, { ...state, revision: state.revision + 1,
          affinities: { ...state.affinities, [ref]: structuredClone(next) },
          sessions: { ...state.sessions, [session.sessionRef]: { ...session, affinityRequired: true } } });
      });
    } catch (error) {
      if (error instanceof GatewayStateError && error.code === 'CONFLICT') {
        throw new RoutePlanError('Affinity transaction conflicted', 'conflict');
      }
      throw error;
    }
  },
});
