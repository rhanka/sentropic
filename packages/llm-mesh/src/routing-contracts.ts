import type { CapabilityRequirement } from './equivalence-council.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from './generation.js';
import type { RoutePolicy, RouteSelector } from './routing-policy.js';
import type { TargetMapping } from './routing-targets.js';

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

export interface RouteAvailabilityDiagnostic {
  readonly code: 'reenrollment-required' | 'reauth-required';
  readonly transportProviderId: string;
  readonly message: string;
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
  /** Optional owner-scoped replacement; known Claude ids retain their Anthropic-first target. */
  readonly targetCandidatesOverride?: readonly TargetMapping[];
  readonly intent?: 'coding' | 'general' | 'reasoning' | 'fast';
  readonly requiredCapabilities?: readonly CapabilityRequirement[];
  readonly affinityKey?: string;
  readonly workspaceId?: string;
  readonly policyProfile?: string;
  readonly policyOverride?: Partial<RoutePolicy>;
  readonly explicit?: RouteSelector;
  /** Pins the plan to a previously issued quote: no unquoted target, no larger attempt count. */
  readonly quote?: RouteQuote;
}

/** Per-request usage upper bound supplied by the caller (gateway-measured). */
export interface RouteUsageCeiling {
  /** Finite integer >= 0. */
  readonly inputTokens: number;
  /** Finite integer >= 1, the request ceiling after the gateway default. */
  readonly outputTokens: number;
  /** Finite integer >= 0 when present. */
  readonly reasoningTokens?: number;
  /** Finite integer >= 0 when present. */
  readonly imageUnits?: number;
  /** Finite integer >= 0 when present. */
  readonly toolCalls?: number;
}

export type RouteQuoteInput = Pick<RoutePlanInput, 'requestedModel' | 'targetCandidatesOverride' | 'intent'
  | 'requiredCapabilities' | 'policyProfile' | 'policyOverride' | 'explicit'>
  & { readonly ceiling: RouteUsageCeiling; readonly now: Date };

export interface QuotedRouteCandidate {
  readonly providerId: string;
  readonly modelId: string;
  /** Present only when the route pins a transport; otherwise any enrolled transport may serve it. */
  readonly transportProviderId?: string;
  readonly reason: PlannedRouteTarget['reason'];
  /** Usage allowance for one attempt. */
  readonly allowance: RouteUsageCeiling;
  /** False when the serving transport may drop the output ceiling (codex). */
  readonly outputCeilingEnforced: boolean;
}

export interface RouteQuote {
  /** Deterministic digest of the route input, revisions and quoted body. */
  readonly quoteRef: string;
  readonly requestedModel: string;
  readonly candidates: readonly QuotedRouteCandidate[];
  /** Resolved policy attempt cap, 1..8. */
  readonly maxAttempts: number;
  /**
   * ISO instant of the quote's `now`; `plan({ quote })` evaluates council
   * freshness at this instant so the plan never diverges from the quote.
   */
  readonly quotedAt: string;
  /** Policy profile revision, or 'default' when no profile applies. */
  readonly policyRevision: string;
  readonly councilRevision: string;
}

export type RouteQuoteErrorCode =
  | 'unknown-model'
  | 'capabilities-unmet'
  | 'invalid-ceiling'
  | 'too-many-candidates';

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

export interface RouteModelInventoryEntry {
  readonly modelId: string;
  readonly providerId: string;
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
  listDiagnostics?(
    subject: VerifiedRoutingSubject,
  ): Promise<readonly RouteAvailabilityDiagnostic[]>;
  prepareAttempt(input: {
    readonly subject: VerifiedRoutingSubject;
    /** Mesh-internal affinity reference; never exposed in a route plan. */
    readonly affinityRef?: string;
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
  /** Owner-scoped executable inventory for provider-compatible model listing. */
  listModels?(
    subject: VerifiedRoutingSubject,
  ): Promise<readonly RouteModelInventoryEntry[]>;
  plan(subject: VerifiedRoutingSubject, input: RoutePlanInput): Promise<RoutePlan>;
  /** Pure, synchronous candidate and usage bounds; never touches accounts. */
  quote?(input: RouteQuoteInput): RouteQuote;
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
