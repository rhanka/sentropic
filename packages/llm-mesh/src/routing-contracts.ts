import type { CapabilityRequirement } from './equivalence-council.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from './generation.js';
import type { RoutePolicy, RouteSelector } from './routing-policy.js';

export interface VerifiedRoutingSubject {
  readonly principalRef: string;
  readonly ownerScopeRef: string;
  readonly grants?: readonly string[];
}

export interface EligibleAccountDescriptor {
  readonly accountRef: string;
  readonly diagnosticAccountRef: string;
  readonly targetProviderId: string;
  readonly transportProviderId: string;
  readonly supportedModelIds: readonly string[];
  readonly enrollmentCompletedAt: string;
  readonly readiness: 'ready' | 'cooldown' | 'reauth-required' | 'disabled';
  readonly revision: string;
}

export interface PlannedRouteTarget {
  readonly requestedModel: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId: string;
  readonly effort?: string;
  readonly reason: 'exact' | 'alias' | 'equivalent' | 'sticky' | 'promoted';
}

export interface RoutePlanInput {
  readonly requestedModel: string;
  readonly intent?: 'coding' | 'general' | 'reasoning' | 'fast';
  readonly requiredCapabilities?: readonly CapabilityRequirement[];
  readonly affinityKey?: string;
  readonly workspaceId?: string;
  readonly policyProfile?: string;
  readonly policyOverride?: Partial<RoutePolicy>;
  readonly explicit?: RouteSelector;
}

export interface RouteDiagnostic {
  readonly candidateRef: string;
  readonly diagnosticAccountRef: string;
  readonly requestedModel: string;
  readonly actualProviderId: string;
  readonly actualModelId: string;
  readonly actualTransportProviderId: string;
  readonly reason: PlannedRouteTarget['reason'];
  readonly cacheContinuityRisk: boolean;
  readonly suppressed?: boolean;
}

export interface RoutePlan {
  readonly planRef: string;
  readonly expiresAt: string;
  readonly candidateRefs: readonly string[];
  readonly policy: RoutePolicy;
  readonly councilRevision: string;
  readonly diagnostics: readonly RouteDiagnostic[];
}

export type RouteOutcomeReason =
  | 'success'
  | 'network-unavailable'
  | 'provider-5xx'
  | 'rate-limited'
  | 'auth-failed'
  | 'reauth-required'
  | 'unsupported-model'
  | 'invalid-request'
  | 'cancelled';

export interface RouteFailureClassification {
  readonly reason: RouteOutcomeReason;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly healthScope: 'route' | 'account' | 'transport' | 'provider-model';
}

export interface RouteAttemptUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimated: boolean;
}

export interface PreparedRouteAttempt {
  readonly attemptRef: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  stream(request: StreamRequest): Promise<StreamResult>;
  recordOutcome(classification: RouteFailureClassification, usage?: RouteAttemptUsage): Promise<void>;
  markCommitted(): Promise<void>;
  complete(usage?: RouteAttemptUsage): Promise<void>;
  releaseCancelled(): Promise<void>;
}

export interface AccountDirectoryPort {
  listEligible(subject: VerifiedRoutingSubject): Promise<readonly EligibleAccountDescriptor[]>;
  prepareAttempt(input: {
    readonly subject: VerifiedRoutingSubject;
    readonly accountRef: string;
    readonly target: PlannedRouteTarget;
    readonly requestId: string;
    readonly attemptIndex: number;
  }): Promise<PreparedRouteAttempt>;
}

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(prefix: 'plan' | 'candidate' | 'attempt'): string;
}

export interface AffinityDescription {
  readonly affinityRef: string;
  readonly revision: number;
  readonly diagnosticAccountRef: string;
  readonly target: PlannedRouteTarget;
  readonly promoted: boolean;
}

export interface AffinityMutationEvent {
  readonly operation: 'promote' | 'reset' | 'rebind';
  readonly subjectRef: string;
  readonly affinityRef: string;
  readonly previousRevision: number;
  readonly nextRevision?: number;
  readonly cacheContinuityRisk: boolean;
}

export interface RoutePlanner {
  plan(subject: VerifiedRoutingSubject, input: RoutePlanInput): Promise<RoutePlan>;
  prepareAttempt(
    subject: VerifiedRoutingSubject,
    planRef: string,
    candidateRef: string,
    requestId: string,
    attemptIndex: number,
  ): Promise<PreparedRouteAttempt>;
  describeAffinity(
    subject: VerifiedRoutingSubject, affinityKey: string, workspaceId?: string,
  ): AffinityDescription | null;
  promoteAffinity(
    subject: VerifiedRoutingSubject, planRef: string, candidateRef: string,
    expectedRevision?: number,
  ): AffinityDescription;
  rebindAffinity(
    subject: VerifiedRoutingSubject, planRef: string, candidateRef: string,
    expectedRevision?: number,
  ): AffinityDescription;
  resetAffinity(
    subject: VerifiedRoutingSubject, affinityKey: string, expectedRevision?: number,
    workspaceId?: string,
  ): boolean;
}
