import type { RankedRouteCandidate } from './route-selection.js';
import type {
  AffinityDescription,
  IdFactory,
  RouteAvailabilityDiagnostic,
  RoutePlan,
  VerifiedRoutingSubject,
} from './routing-contracts.js';
import type { RoutePolicy } from './routing-policy.js';

export interface StoredCandidate extends RankedRouteCandidate {
  readonly candidateRef: string;
}

export interface StoredPlan {
  readonly plan: RoutePlan;
  readonly subjectRef: string;
  readonly affinityRef?: string;
  readonly affinityRevision?: number;
  readonly policyProfileName?: string;
  readonly policyProfileRevision?: string;
  readonly hadAffinity: boolean;
  readonly candidates: readonly StoredCandidate[];
  readonly policy: RoutePolicy;
  readonly claimedAttempts: Set<string>;
  readonly roundRobinKey?: string;
}

export interface StoredAffinity extends AffinityDescription {
  readonly accountRef: string;
  readonly workspaceId?: string;
}

export class RoutePlanError extends Error {
  constructor(
    message: string,
    readonly code: 'no-route' | 'unknown-model' | 'capabilities-unmet' | 'invalid-plan' | 'expired-plan' | 'stale-candidate' | 'conflict'
      | 'quote-mismatch',
    readonly diagnostic?: RouteAvailabilityDiagnostic,
    /**
     * Every transport-matching availability entry (Lot 7): by caller
     * convention `diagnostic` stays the first match for back-compat (not a
     * constructor invariant — both arguments are independently optional);
     * this carries the full per-transport list. Transport diagnostics
     * reflect the matching entries, not necessarily every candidate or
     * every failure cause.
     */
    readonly diagnostics?: readonly RouteAvailabilityDiagnostic[],
  ) {
    super(message);
    this.name = 'RoutePlanError';
  }
}

export const subjectRef = (subject: VerifiedRoutingSubject): string =>
  `${subject.principalRef}\u001f${subject.ownerScopeRef}`;

export const routingOwnerRef = (subject: VerifiedRoutingSubject): string =>
  subject.ownerScopeRef;

export const affinityRef = (
  subject: VerifiedRoutingSubject,
  affinityKey: string,
  workspaceId?: string,
): string => [routingOwnerRef(subject), workspaceId ?? '', affinityKey].join('\u001f');

export const mergeRoutePolicy = (
  base: RoutePolicy,
  override?: Partial<RoutePolicy>,
): RoutePolicy => ({
  ...base,
  ...override,
  strategy: override?.strategy ?? base.strategy,
  rules: override?.rules ?? base.rules,
});

export class SequentialIdFactory implements IdFactory {
  private sequence = 0;

  next(prefix: 'plan' | 'candidate' | 'attempt'): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString(36)}`;
  }
}
