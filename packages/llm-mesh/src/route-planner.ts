import { DEFAULT_MODEL_EQUIVALENCE_COUNCIL, type ModelEquivalenceCouncil } from './equivalence-council.js';
import { prepareStoredRouteAttempt } from './route-attempt.js';
import { InMemoryRouteHealth } from './route-health.js';
import {
  affinityRef, RoutePlanError, SequentialIdFactory,
  routingOwnerRef, subjectRef, type StoredAffinity, type StoredPlan,
} from './route-planner-state.js';
import {
  isNativeMessagesTarget, NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS,
  validateNativeModelAllowlist,
} from './native-messages.js';
import { resolveRequestedTargets, selectRouteCandidates, type RankedRouteCandidate } from './route-selection.js';
import { EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS } from './routing-targets.js';
import type {
  AccountDirectoryPort, AffinityDescription, Clock, IdFactory, PreparedRouteAttempt,
  AffinityMutationEvent, RoutePlan, RoutePlanInput, RoutePlanner, VerifiedRoutingSubject,
  RouteModelInventoryEntry, RouteQuote, RouteQuoteInput,
} from './routing-contracts.js';
import { computeRouteQuoteRef, isQuotedRouteTarget, quoteRoute, resolveQuotePolicy } from './route-quote.js';
import { InMemoryRoutePolicyProfiles, resolveRouteStrategy } from './routing-policy.js';
/**
 * Exclusive-alias migration (owner "follow the /model"): a stored affinity
 * whose provider, model or transport differs from the exclusive target is
 * treated as absent at plan time, so a `/model` switch plans fresh Astra and
 * never emits the stale sticky candidate. Stored state is never mutated here;
 * a later success rebinds it (see bind), a failure leaves it untouched.
 * Quoted and unquoted plans behave the same.
 */
const isExclusiveAliasMismatch = (
  requestedModel: string,
  affinity: StoredAffinity | undefined,
): boolean => {
  const exclusive = EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS[requestedModel];
  return Boolean(exclusive && affinity
    && (affinity.target.providerId !== exclusive.providerId
      || affinity.target.modelId !== exclusive.model
      || affinity.target.transportProviderId !== exclusive.transportProviderId));
};

export interface InMemoryRoutePlannerOptions {
  readonly directory: AccountDirectoryPort;
  readonly council?: ModelEquivalenceCouncil;
  readonly profiles?: InMemoryRoutePolicyProfiles;
  readonly nativeMessagesModelIds?: readonly string[];
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
  private readonly nativeMessagesModelIds: readonly string[];
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
    this.nativeMessagesModelIds = options.nativeMessagesModelIds !== undefined
      ? validateNativeModelAllowlist(options.nativeMessagesModelIds)
      : NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS;
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
        // Exclusive launch aliases are request contracts, not inventory models.
        if (EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS[modelId]) continue;
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
    const { profile, policy: resolvedPolicy } = resolveQuotePolicy(input, this.profiles);
    const { quote } = input;
    if (quote) this.assertQuoteMatches(input, quote, profile?.name, profile?.revision);
    const policy = quote && quote.maxAttempts < resolvedPolicy.maxAttempts
      ? { ...resolvedPolicy, maxAttempts: quote.maxAttempts }
      : resolvedPolicy;
    const inQuoteTarget = (target: RankedRouteCandidate['target']): boolean =>
      !quote || isQuotedRouteTarget(quote, target);
    const inQuote = (candidate: RankedRouteCandidate): boolean => inQuoteTarget(candidate.target);
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
    const selection = selectRouteCandidates({
      request: input, policy, council: this.council, accounts,
      roundRobinOffset,
      // A pinned plan resolves council freshness at the quote instant, like the quote.
      now: quote ? new Date(quote.quotedAt) : this.clock.now(),
      applyAttemptLimit: false,
    });
    if (selection.kind === 'unknown-model') {
      throw new RoutePlanError('Unknown requested model', 'unknown-model');
    }
    if (selection.kind === 'capabilities-unmet') {
      throw new RoutePlanError('Required capabilities are unavailable', 'capabilities-unmet');
    }
    if (input.nativeMessages === true) {
      if (
        Object.hasOwn(EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS, input.requestedModel)
        || !isNativeMessagesTarget({ providerId: 'anthropic', modelId: input.requestedModel }, this.nativeMessagesModelIds)
      ) {
        throw new RoutePlanError(
          'Native Anthropic Messages execution is unavailable for this request',
          'native-unavailable',
        );
      }
    }
    let candidates = selection.kind === 'candidates' ? [...selection.candidates] : [];
    if (input.nativeMessages === true) {
      const hadCandidates = candidates.length > 0;
      candidates = candidates.filter((candidate) =>
        candidate.account.nativeMessages?.contractVersion === 1
        && candidate.account.nativeMessages.protocol === 'anthropic-messages'
        && isNativeMessagesTarget(candidate.target, this.nativeMessagesModelIds)
        && candidate.target.modelId === input.requestedModel);
      if (hadCandidates && candidates.length === 0) {
        throw new RoutePlanError(
          'Native Anthropic Messages execution is unavailable for this request',
          'native-unavailable',
        );
      }
    }
    // With a quote, an affinity to an unquoted target is ignored for selection
    // (for example a sticky model the request no longer asks for).
    // An exclusive alias additionally migrates an incompatible stored affinity
    // (see isExclusiveAliasMismatch): the stale sticky candidate is never
    // emitted, quoted and unquoted alike.
    const stickyAccount = affinity
      ? accounts.find((entry) => entry.accountRef === affinity.accountRef)
      : undefined;
    const isAffinityEligible = Boolean(
      affinity && policy.stickyAccount
      && !isExclusiveAliasMismatch(input.requestedModel, affinity)
      && inQuoteTarget(affinity.target)
      && (!input.nativeMessages || (
        stickyAccount?.nativeMessages?.contractVersion === 1
        && stickyAccount.nativeMessages.protocol === 'anthropic-messages'
        && isNativeMessagesTarget(affinity.target, this.nativeMessagesModelIds)
        && affinity.target.modelId === input.requestedModel
      ))
    );
    if (affinity && isAffinityEligible) {
      const account = stickyAccount;
      if (!account || account.readiness !== 'ready') {
        candidates = [];
      } else {
        const sameAccount = candidates.filter((candidate) =>
          candidate.account.accountRef === affinity.accountRef
          && !this.isAffinityTarget(candidate, affinity));
        const rotated = policy.rotateEquivalentAccounts
          ? candidates.filter((candidate) => candidate.account.accountRef !== affinity.accountRef)
          : [];
        const exclusiveAlias = EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS[input.requestedModel];
        const eligibleSticky = candidates.find((candidate) =>
          candidate.account.accountRef === affinity.accountRef
          && this.isAffinityTarget(candidate, affinity));
        // An exclusive alias builds its sticky target from the current
        // resolved Astra candidate, so a stored effort override from another
        // alias never leaks into this request; account stickiness is kept.
        const sticky: RankedRouteCandidate = {
          account,
          target: exclusiveAlias && eligibleSticky
            ? {
              requestedModel: input.requestedModel,
              providerId: eligibleSticky.target.providerId,
              modelId: eligibleSticky.target.modelId,
              transportProviderId: eligibleSticky.target.transportProviderId,
              reason: 'sticky',
            }
            : { ...affinity.target, requestedModel: input.requestedModel, reason: 'sticky' },
        };
        // An exclusive alias serves a compatible affinity only when its
        // account still resolves an eligible Astra candidate (same account,
        // Astra target, account ready, Astra advertised/allowed): otherwise
        // the plan fails closed with `no-route` (owner Q6) instead of
        // serving the stale sticky candidate, regardless of `explicit`.
        const exclusiveBlocked = Boolean(exclusiveAlias && !eligibleSticky);
        candidates = exclusiveBlocked
          ? []
          : this.keepQuoted([sticky, ...sameAccount, ...rotated], inQuote)
            .filter((candidate) => !this.health.isSuppressed(candidate))
            .slice(0, policy.maxAttempts);
      }
    } else {
      candidates = this.keepQuoted(candidates, inQuote)
        .filter((candidate) => !this.health.isSuppressed(candidate))
        .slice(0, policy.maxAttempts);
    }
    if (candidates.length === 0) {
      // A diagnostic is only pertinent when it belongs to the requested
      // route's transports. Surfacing listDiagnostics[0] unfiltered once
      // prescribed a `muse reauthenticate` for an explicit codex request.
      // The model-derived resolution ignores `explicit`, so an explicit
      // transport restriction wins over it here.
      const explicitTransport = input.explicit?.transportProviderId;
      const resolution = resolveRequestedTargets(input);
      const transports = new Set<string>(
        explicitTransport
          ? [explicitTransport]
          : resolution.kind === 'known'
            ? resolution.targets
              .map((target) => target.transportProviderId)
              .filter((transport): transport is string => typeof transport === 'string')
            : [],
      );
      const diagnostics = await this.options.directory.listDiagnostics?.(subject) ?? [];
      const diagnostic = diagnostics.find((entry) => transports.has(entry.transportProviderId));
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
  quote(input: RouteQuoteInput): RouteQuote {
    return quoteRoute(input, {
      council: this.council,
      profiles: this.profiles,
      nativeMessagesModelIds: this.nativeMessagesModelIds,
    });
  }
  private assertQuoteMatches(input: RoutePlanInput, quote: RouteQuote,
    profileName: string | undefined, profileRevision: string | undefined): void {
    const { quoteRef, ...body } = quote;
    if (quote.requestedModel !== input.requestedModel
      || !Number.isFinite(Date.parse(quote.quotedAt))
      || quote.councilRevision !== this.council.revision
      || quote.policyRevision !== (profileRevision ?? 'default')
      || quoteRef !== computeRouteQuoteRef(input, profileName, body)) {
      throw new RoutePlanError('Route quote does not match this plan', 'quote-mismatch');
    }
  }
  private keepQuoted(candidates: RankedRouteCandidate[],
    inQuote: (candidate: RankedRouteCandidate) => boolean): RankedRouteCandidate[] {
    const quoted = candidates.filter(inQuote);
    if (candidates.length > 0 && quoted.length === 0) {
      throw new RoutePlanError('No planned route is covered by the quote', 'quote-mismatch');
    }
    return quoted;
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
        onCommitted: (activePlan, candidate) => this.bind(activePlan, candidate, true),
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

  private bind(stored: StoredPlan, candidate: RankedRouteCandidate, isCommit = false): void {
    this.commitRoundRobin(stored);
    if (!stored.affinityRef) return;
    const current = this.affinities.get(stored.affinityRef);
    // Exclusive-alias migration (owner "follow the /model"): a success on
    // the exclusive alias overwrites a stale incompatible affinity with the
    // served Astra account and target through the existing audited
    // rebind/promote path below (`cacheContinuityRisk` on account change).
    // A commit (first validated frame) must not migrate, so a later stream
    // failure or cancellation leaves the stale affinity untouched.
    const exclusiveMigration = Boolean(
      EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS[candidate.target.requestedModel] && current
        && (current.target.providerId !== candidate.target.providerId
          || current.target.modelId !== candidate.target.modelId
          || current.target.transportProviderId !== candidate.target.transportProviderId),
    );
    if (isCommit && exclusiveMigration) return;
    if (current && stored.policy.fallbackMode !== 'one-way' && !exclusiveMigration) return;
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
