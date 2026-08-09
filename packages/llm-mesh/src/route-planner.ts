import { DEFAULT_MODEL_EQUIVALENCE_COUNCIL, type ModelEquivalenceCouncil } from './equivalence-council.js';
import { prepareStoredRouteAttempt } from './route-attempt.js';
import { InMemoryRouteHealth } from './route-health.js';
import {
  affinityRef, mergeRoutePolicy, RoutePlanError, SequentialIdFactory,
  subjectRef, type StoredAffinity, type StoredPlan,
} from './route-planner-state.js';
import { selectRouteCandidates, type RankedRouteCandidate } from './route-selection.js';
import type {
  AccountDirectoryPort, AffinityDescription, Clock, IdFactory, PreparedRouteAttempt,
  AffinityMutationEvent, RoutePlan, RoutePlanInput, RoutePlanner, VerifiedRoutingSubject,
} from './routing-contracts.js';
import {
  DEFAULT_ROUTE_POLICY, InMemoryRoutePolicyProfiles, resolveRoutePolicy, validateRoutePolicy,
} from './routing-policy.js';
export interface InMemoryRoutePlannerOptions {
  readonly directory: AccountDirectoryPort;
  readonly council?: ModelEquivalenceCouncil;
  readonly profiles?: InMemoryRoutePolicyProfiles;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly planTtlMs?: number;
  readonly affinityAudit?: (event: AffinityMutationEvent) => void;
}
export class InMemoryRoutePlanner implements RoutePlanner {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly affinities = new Map<string, StoredAffinity>();
  private readonly roundRobin = new Map<string, number>();
  private readonly clock: Clock;
  private readonly ids: IdFactory;
  private readonly council: ModelEquivalenceCouncil;
  private readonly profiles: InMemoryRoutePolicyProfiles;
  private readonly health: InMemoryRouteHealth;
  private readonly planTtlMs: number;

  constructor(private readonly options: InMemoryRoutePlannerOptions) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.ids = options.idFactory ?? new SequentialIdFactory();
    this.council = options.council ?? DEFAULT_MODEL_EQUIVALENCE_COUNCIL;
    this.profiles = options.profiles ?? new InMemoryRoutePolicyProfiles();
    this.health = new InMemoryRouteHealth(this.clock);
    this.planTtlMs = options.planTtlMs ?? 30_000;
  }
  async plan(subject: VerifiedRoutingSubject, input: RoutePlanInput): Promise<RoutePlan> {
    this.evictPlans();
    const profile = input.policyProfile
      ? this.profiles.list().find((entry) => entry.name === input.policyProfile)
      : this.profiles.active();
    if (input.policyProfile && !profile) throw new RoutePlanError('Unknown policy profile', 'no-route');
    const policy = resolveRoutePolicy(
      mergeRoutePolicy(profile?.policy ?? DEFAULT_ROUTE_POLICY, input.policyOverride), input,
    );
    validateRoutePolicy(policy);
    const affinity = input.affinityKey
      ? this.affinities.get(affinityRef(subject, input.affinityKey, input.workspaceId))
      : undefined;
    const accounts = await this.options.directory.listEligible(subject);
    const roundRobinKey = `${subjectRef(subject)}\u001f${input.requestedModel}`;
    let candidates = [...selectRouteCandidates({
      request: input, policy, council: this.council, accounts,
      roundRobinOffset: this.roundRobin.get(roundRobinKey) ?? 0,
      now: this.clock.now(),
    })];
    if (affinity && policy.stickyAccount) {
      const account = accounts.find((entry) => entry.accountRef === affinity.accountRef);
      if (!account || account.readiness !== 'ready') {
        candidates = [];
      } else {
        const sameAccount = candidates.filter((candidate) =>
          candidate.account.accountRef === affinity.accountRef
          && !this.isAffinityTarget(candidate, affinity));
        const rotated = policy.rotateEquivalentAccounts
          ? candidates.filter((candidate) => candidate.account.accountRef !== affinity.accountRef)
          : [];
        const sticky: RankedRouteCandidate = {
          account,
          target: { ...affinity.target, requestedModel: input.requestedModel, reason: 'sticky' },
        };
        candidates = [sticky, ...sameAccount, ...rotated]
          .filter((candidate) => !this.health.isSuppressed(candidate))
          .slice(0, policy.maxAttempts);
      }
    } else {
      candidates = candidates.filter((candidate) => !this.health.isSuppressed(candidate));
      this.roundRobin.set(roundRobinKey, (this.roundRobin.get(roundRobinKey) ?? 0) + 1);
    }
    if (candidates.length === 0) throw new RoutePlanError('No eligible route', 'no-route');
    const planRef = this.ids.next('plan');
    const storedCandidates = candidates.map((candidate) => ({
      ...candidate, candidateRef: this.ids.next('candidate'),
    }));
    const plan: RoutePlan = {
      planRef,
      expiresAt: new Date(this.clock.now().getTime() + this.planTtlMs).toISOString(),
      candidateRefs: storedCandidates.map((candidate) => candidate.candidateRef),
      policy,
      councilRevision: this.council.revision,
      diagnostics: storedCandidates.map((candidate) => ({
        candidateRef: candidate.candidateRef,
        diagnosticAccountRef: candidate.account.diagnosticAccountRef,
        requestedModel: input.requestedModel,
        actualProviderId: candidate.target.providerId,
        actualModelId: candidate.target.modelId,
        actualTransportProviderId: candidate.target.transportProviderId,
        reason: candidate.target.reason,
        cacheContinuityRisk: Boolean(affinity && affinity.accountRef !== candidate.account.accountRef),
      })),
    };
    this.plans.set(planRef, {
      plan, subjectRef: subjectRef(subject), candidates: storedCandidates, policy,
      hadAffinity: Boolean(affinity),
      ...(affinity ? { affinityRevision: affinity.revision } : {}),
      ...(profile ? {
        policyProfileName: profile.name,
        policyProfileRevision: profile.revision,
      } : {}),
      ...(input.affinityKey
        ? { affinityRef: affinityRef(subject, input.affinityKey, input.workspaceId) }
        : {}),
    });
    return plan;
  }
  async prepareAttempt(subject: VerifiedRoutingSubject, planRef: string, candidateRef: string,
    requestId: string, attemptIndex: number): Promise<PreparedRouteAttempt> {
    const stored = this.plans.get(planRef);
    if (stored?.plan.councilRevision !== this.council.revision) {
      throw new RoutePlanError('Route council revision changed', 'invalid-plan');
    }
    if (stored?.affinityRef && stored.affinityRevision !== undefined
      && this.affinities.get(stored.affinityRef)?.revision !== stored.affinityRevision) {
      throw new RoutePlanError('Route affinity revision changed', 'conflict');
    }
    if (stored?.policyProfileName && this.profiles.list().find(
      (profile) => profile.name === stored.policyProfileName,
    )?.revision !== stored.policyProfileRevision) {
      throw new RoutePlanError('Route policy revision changed', 'invalid-plan');
    }
    return prepareStoredRouteAttempt({
      stored, subject, planRef, candidateRef, requestId, attemptIndex,
      directory: this.options.directory, clock: this.clock,
      onOutcome: (candidate, failure) => this.health.record(candidate, failure,
        this.plans.get(planRef)?.policy ?? DEFAULT_ROUTE_POLICY),
      onCommitted: (stored, candidate) => this.bind(stored, candidate),
      onSuccess: (stored, candidate) => { this.health.clear(candidate); this.bind(stored, candidate); },
    });
  }

  describeAffinity(subject: VerifiedRoutingSubject, key: string, workspaceId?: string): AffinityDescription | null {
    return this.affinities.get(affinityRef(subject, key, workspaceId)) ?? null;
  }

  promoteAffinity(subject: VerifiedRoutingSubject, planRef: string, candidateRef: string,
    expectedRevision?: number): AffinityDescription {
    return this.mutateAffinity(subject, planRef, candidateRef, false, expectedRevision);
  }

  rebindAffinity(subject: VerifiedRoutingSubject, planRef: string, candidateRef: string,
    expectedRevision?: number): AffinityDescription {
    return this.mutateAffinity(subject, planRef, candidateRef, true, expectedRevision);
  }

  resetAffinity(subject: VerifiedRoutingSubject, key: string, expectedRevision?: number,
    workspaceId?: string): boolean {
    const ref = affinityRef(subject, key, workspaceId); const current = this.affinities.get(ref);
    if (!current) return false;
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new RoutePlanError('Affinity revision changed', 'conflict');
    }
    const removed = this.affinities.delete(ref);
    if (removed) this.options.affinityAudit?.({
      operation: 'reset', subjectRef: subjectRef(subject), affinityRef: ref,
      previousRevision: current.revision, cacheContinuityRisk: false,
    });
    return removed;
  }

  private mutateAffinity(subject: VerifiedRoutingSubject, planRef: string, candidateRef: string,
    allowRebind: boolean, expectedRevision?: number): AffinityDescription {
    const stored = this.plans.get(planRef);
    if (!stored || stored.subjectRef !== subjectRef(subject) || !stored.affinityRef) {
      throw new RoutePlanError('Invalid affinity plan', 'invalid-plan');
    }
    const candidate = stored.candidates.find((entry) => entry.candidateRef === candidateRef);
    const current = this.affinities.get(stored.affinityRef);
    if (!candidate || !current) throw new RoutePlanError('Affinity candidate missing', 'invalid-plan');
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new RoutePlanError('Affinity revision changed', 'conflict');
    }
    const rebind = current.accountRef !== candidate.account.accountRef;
    if (rebind && !allowRebind) throw new RoutePlanError('Promotion cannot change account', 'conflict');
    const next: StoredAffinity = {
      ...current, accountRef: candidate.account.accountRef,
      diagnosticAccountRef: candidate.account.diagnosticAccountRef,
      target: candidate.target, revision: current.revision + 1, promoted: !rebind,
    };
    this.affinities.set(stored.affinityRef, next);
    this.options.affinityAudit?.({
      operation: rebind ? 'rebind' : 'promote', subjectRef: subjectRef(subject),
      affinityRef: stored.affinityRef, previousRevision: current.revision,
      nextRevision: next.revision, cacheContinuityRisk: rebind,
    });
    return next;
  }

  private bind(stored: StoredPlan, candidate: RankedRouteCandidate): void {
    if (!stored.affinityRef) return;
    const current = this.affinities.get(stored.affinityRef);
    if (current && stored.policy.fallbackMode !== 'one-way') return;
    if (current?.target.providerId === candidate.target.providerId
      && current.target.modelId === candidate.target.modelId
      && current.target.transportProviderId === candidate.target.transportProviderId) return;
    const rebind = Boolean(current && current.accountRef !== candidate.account.accountRef);
    const next: StoredAffinity = {
      affinityRef: stored.affinityRef, accountRef: candidate.account.accountRef,
      diagnosticAccountRef: candidate.account.diagnosticAccountRef,
      target: candidate.target, revision: (current?.revision ?? 0) + 1,
      promoted: Boolean(current && !rebind),
    };
    this.affinities.set(stored.affinityRef, next);
    if (current) this.options.affinityAudit?.({
      operation: rebind ? 'rebind' : 'promote', subjectRef: stored.subjectRef,
      affinityRef: stored.affinityRef, previousRevision: current.revision,
      nextRevision: next.revision, cacheContinuityRisk: rebind,
    });
  }

  private isAffinityTarget(candidate: RankedRouteCandidate, affinity: StoredAffinity): boolean {
    return candidate.target.providerId === affinity.target.providerId
      && candidate.target.modelId === affinity.target.modelId
      && candidate.target.transportProviderId === affinity.target.transportProviderId;
  }

  private evictPlans(): void {
    const now = this.clock.now().getTime();
    for (const [ref, stored] of this.plans) {
      if (Date.parse(stored.plan.expiresAt) <= now) this.plans.delete(ref);
    }
  }
}
