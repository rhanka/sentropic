import { DEFAULT_MODEL_EQUIVALENCE_COUNCIL, type ModelEquivalenceCouncil } from './equivalence-council.js';
import { prepareStoredRouteAttempt } from './route-attempt.js';
import { InMemoryRouteHealth } from './route-health.js';
import {
  affinityRef, mergeRoutePolicy, RoutePlanError, SequentialIdFactory,
  routingOwnerRef, subjectRef, type StoredAffinity, type StoredPlan,
} from './route-planner-state.js';
import { selectRouteCandidates, type RankedRouteCandidate } from './route-selection.js';
import type {
  AccountDirectoryPort, AffinityDescription, Clock, IdFactory, PreparedRouteAttempt,
  AffinityMutationEvent, RoutePlan, RoutePlanInput, RoutePlanner, VerifiedRoutingSubject,
  RouteModelInventoryEntry,
} from './routing-contracts.js';
import {
  DEFAULT_ROUTE_POLICY, InMemoryRoutePolicyProfiles, resolveRoutePolicy,
  resolveRouteStrategy, validateRoutePolicy,
} from './routing-policy.js';
export interface InMemoryRoutePlannerOptions {
  readonly directory: AccountDirectoryPort;
  readonly council?: ModelEquivalenceCouncil;
  readonly profiles?: InMemoryRoutePolicyProfiles;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly planTtlMs?: number;
  readonly maximumPlanEntries?: number;
  readonly maximumAffinityEntries?: number;
  readonly maximumRoundRobinEntries?: number;
  readonly affinityAudit?: (event: AffinityMutationEvent) => void;
}
export class InMemoryRoutePlanner implements RoutePlanner {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly affinities = new Map<string, StoredAffinity>();
  private readonly roundRobin = new Map<string, {
    committedOffset: number;
    reservations: Set<string>;
  }>();
  private readonly clock: Clock;
  private readonly ids: IdFactory;
  private readonly council: ModelEquivalenceCouncil;
  private readonly profiles: InMemoryRoutePolicyProfiles;
  private readonly health: InMemoryRouteHealth;
  private readonly planTtlMs: number;
  private readonly maximumPlanEntries: number;
  private readonly maximumAffinityEntries: number;
  private readonly maximumRoundRobinEntries: number;

  constructor(private readonly options: InMemoryRoutePlannerOptions) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.ids = options.idFactory ?? new SequentialIdFactory();
    this.council = options.council ?? DEFAULT_MODEL_EQUIVALENCE_COUNCIL;
    this.profiles = options.profiles ?? new InMemoryRoutePolicyProfiles();
    this.health = new InMemoryRouteHealth(this.clock);
    this.planTtlMs = options.planTtlMs ?? 30_000;
    this.maximumPlanEntries = Math.max(1, options.maximumPlanEntries ?? 1_000);
    this.maximumAffinityEntries = Math.max(1, options.maximumAffinityEntries ?? 10_000);
    this.maximumRoundRobinEntries = Math.max(
      this.maximumPlanEntries,
      options.maximumRoundRobinEntries ?? 10_000,
    );
  }
  async listModels(
    subject: VerifiedRoutingSubject,
  ): Promise<readonly RouteModelInventoryEntry[]> {
    const accounts = await this.options.directory.listEligible(subject);
    const inventory = new Map<string, RouteModelInventoryEntry>();
    for (const account of accounts) {
      if (account.readiness !== 'ready') continue;
      for (const modelId of account.supportedModelIds) {
        const key = `${account.targetProviderId}\u001f${modelId}`;
        inventory.set(key, { modelId, providerId: account.targetProviderId });
      }
    }
    return [...inventory.values()].sort((left, right) =>
      left.modelId.localeCompare(right.modelId)
      || left.providerId.localeCompare(right.providerId));
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
    const strategy = resolveRouteStrategy(policy, input);
    const affinity = input.affinityKey
      ? this.affinities.get(affinityRef(subject, input.affinityKey, input.workspaceId))
      : undefined;
    const accounts = await this.options.directory.listEligible(subject);
    const roundRobinKey = `${routingOwnerRef(subject)}\u001f${input.requestedModel}`;
    const roundRobinState = strategy.kind === 'round-robin'
      ? this.roundRobin.get(roundRobinKey)
      : undefined;
    const roundRobinOffset = roundRobinState
      ? roundRobinState.committedOffset + roundRobinState.reservations.size
      : 0;
    let candidates = [...selectRouteCandidates({
      request: input, policy, council: this.council, accounts,
      roundRobinOffset,
      now: this.clock.now(),
      applyAttemptLimit: false,
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
      candidates = candidates
        .filter((candidate) => !this.health.isSuppressed(candidate))
        .slice(0, policy.maxAttempts);
    }
    if (candidates.length === 0) {
      const diagnostic = (await this.options.directory.listDiagnostics?.(subject))?.[0];
      throw new RoutePlanError(
        diagnostic?.message ?? 'No eligible route',
        'no-route',
        diagnostic,
      );
    }
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
      claimedAttempts: new Set(),
      ...(strategy.kind === 'round-robin' && !affinity ? { roundRobinKey } : {}),
    });
    if (strategy.kind === 'round-robin' && !affinity) {
      const state = this.roundRobin.get(roundRobinKey) ?? {
        committedOffset: 0,
        reservations: new Set<string>(),
      };
      state.reservations.add(planRef);
      this.touchRoundRobin(roundRobinKey, state);
    }
    this.trimPlans();
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
    try {
      return await prepareStoredRouteAttempt({
        stored, subject, planRef, candidateRef, requestId, attemptIndex,
        directory: this.options.directory, clock: this.clock,
        onOutcome: (activePlan, candidate, failure) => {
          this.health.record(candidate, failure, activePlan.policy);
          const terminalCandidate = activePlan.candidates.at(-1) === candidate;
          if (!failure.retryable || terminalCandidate) this.releaseRoundRobin(activePlan);
        },
        onCommitted: (activePlan, candidate) => this.bind(activePlan, candidate),
        onSuccess: (activePlan, candidate) => {
          this.health.clear(candidate);
          this.bind(activePlan, candidate);
        },
        onCancelled: (activePlan) => this.releaseRoundRobin(activePlan),
      });
    } catch (error) {
      if (stored && attemptIndex + 1 >= stored.candidates.length) {
        this.releaseRoundRobin(stored);
      }
      throw error;
    }
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
    this.trim(this.affinities, this.maximumAffinityEntries);
    this.options.affinityAudit?.({
      operation: rebind ? 'rebind' : 'promote', subjectRef: subjectRef(subject),
      affinityRef: stored.affinityRef, previousRevision: current.revision,
      nextRevision: next.revision, cacheContinuityRisk: rebind,
    });
    return next;
  }

  private bind(stored: StoredPlan, candidate: RankedRouteCandidate): void {
    this.commitRoundRobin(stored);
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
    this.trim(this.affinities, this.maximumAffinityEntries);
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
      if (Date.parse(stored.plan.expiresAt) <= now) {
        this.releaseRoundRobin(stored);
        this.plans.delete(ref);
      }
    }
  }

  private commitRoundRobin(stored: StoredPlan): void {
    if (!stored.roundRobinKey) return;
    const state = this.roundRobin.get(stored.roundRobinKey);
    if (!state?.reservations.delete(stored.plan.planRef)) return;
    state.committedOffset += 1;
    this.touchRoundRobin(stored.roundRobinKey, state);
  }

  private releaseRoundRobin(stored: StoredPlan): void {
    if (!stored.roundRobinKey) return;
    const state = this.roundRobin.get(stored.roundRobinKey);
    if (!state) return;
    state.reservations.delete(stored.plan.planRef);
    this.touchRoundRobin(stored.roundRobinKey, state);
  }

  private touchRoundRobin(
    key: string,
    state: { committedOffset: number; reservations: Set<string> },
  ): void {
    this.roundRobin.delete(key);
    this.roundRobin.set(key, state);
    while (this.roundRobin.size > this.maximumRoundRobinEntries) {
      const removable = [...this.roundRobin].find(([, candidate]) =>
        candidate.reservations.size === 0);
      if (!removable) break;
      this.roundRobin.delete(removable[0]);
    }
  }

  private trimPlans(): void {
    while (this.plans.size > this.maximumPlanEntries) {
      const oldest = this.plans.entries().next().value as [string, StoredPlan] | undefined;
      if (!oldest) break;
      this.releaseRoundRobin(oldest[1]);
      this.plans.delete(oldest[0]);
    }
  }

  private trim<T>(entries: Map<string, T>, maximum: number): void {
    while (entries.size > maximum) {
      const oldest = entries.keys().next().value;
      if (!oldest) break;
      entries.delete(oldest);
    }
  }
}
