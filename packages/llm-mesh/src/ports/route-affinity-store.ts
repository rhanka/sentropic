import type { PlannedRouteTarget } from '../routing-contracts.js';
export interface RouteAffinityKey {
  readonly ownerScopeRef: string;
  readonly workspaceRef: string;
  readonly clientSessionRef: string;
  readonly policyRevision: string;
}
export interface RouteAffinityRecord extends RouteAffinityKey {
  readonly revision: number;
  readonly accountRef: string;
  readonly diagnosticAccountRef: string;
  readonly accountEpoch: number;
  readonly target: PlannedRouteTarget;
}
/** Trusted protected storage; a successful CAS durably acknowledges the pin. */
export interface RouteAffinityStore {
  read(key: RouteAffinityKey): Promise<RouteAffinityRecord | null>;
  compareAndSet(key: RouteAffinityKey, expectedRevision: number, next: RouteAffinityRecord): Promise<void>;
}
export const routeAffinityRef = (key: RouteAffinityKey): string => JSON.stringify([
  'route-affinity/v1', key.ownerScopeRef, key.workspaceRef, key.clientSessionRef, key.policyRevision,
]);
