import { modelProfiles, type ModelProfile } from './catalog.js';
import { modelSupportsCapability, type ModelEquivalenceCouncil } from './equivalence-council.js';
import type { EligibleAccountDescriptor, PlannedRouteTarget, RoutePlanInput } from './routing-contracts.js';
import { resolveRouteStrategy, type RoutePolicy, type RouteSelector } from './routing-policy.js';
import { createCanonicalTargetResolver } from './routing-targets.js';
export interface RankedRouteCandidate {
  readonly account: EligibleAccountDescriptor;
  readonly target: PlannedRouteTarget;
}
interface ResolvedRouteTarget {
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId?: string;
  readonly effort?: string;
  readonly transportPreferences?: readonly string[];
  readonly reason: PlannedRouteTarget['reason'];
}
const resolveCanonical = createCanonicalTargetResolver();
const supportsCapabilities = (
  profile: ModelProfile | undefined,
  required: RoutePlanInput['requiredCapabilities'],
): boolean => !required?.length
  || required.every((capability) => modelSupportsCapability(profile, capability));

const selectorMatches = (
  selector: RouteSelector,
  candidate: RankedRouteCandidate,
  requestedModel: string,
): boolean =>
  (!selector.providerId || selector.providerId === candidate.target.providerId)
  && (!selector.modelId || selector.modelId === candidate.target.modelId)
  && (!selector.alias || selector.alias === requestedModel)
  && (!selector.transportProviderId
    || selector.transportProviderId === candidate.target.transportProviderId)
  && (!selector.diagnosticAccountRef
    || selector.diagnosticAccountRef === candidate.account.diagnosticAccountRef);

const resolveRequestedTarget = (requestedModel: string): {
  providerId: string;
  model: string;
  transportProviderId?: string;
  effort?: string;
  reason: 'exact' | 'alias';
} | undefined => {
  const canonical = resolveCanonical(requestedModel);
  if (canonical) return { ...canonical, reason: requestedModel === canonical.model ? 'exact' as const : 'alias' as const };
  const profile = modelProfiles.find((candidate) => candidate.modelId === requestedModel);
  return profile ? {
    providerId: profile.providerId,
    model: profile.modelId,
    reason: 'exact' as const,
  } : undefined;
};

export const selectRouteCandidates = (input: {
  readonly request: RoutePlanInput;
  readonly policy: RoutePolicy;
  readonly council: ModelEquivalenceCouncil;
  readonly accounts: readonly EligibleAccountDescriptor[];
  readonly roundRobinOffset?: number;
  readonly now?: Date;
  readonly applyAttemptLimit?: boolean;
}): readonly RankedRouteCandidate[] => {
  const resolved = resolveRequestedTarget(input.request.requestedModel);
  if (!resolved) return [];
  const requestedProfile = modelProfiles.find((profile) =>
    profile.providerId === resolved.providerId && profile.modelId === resolved.model);
  if (!supportsCapabilities(requestedProfile, input.request.requiredCapabilities)) return [];

  const targets: ResolvedRouteTarget[] = [{
    providerId: resolved.providerId,
    modelId: resolved.model,
    ...(resolved.effort ? { effort: resolved.effort } : {}),
    ...(resolved.transportProviderId
      ? { transportProviderId: resolved.transportProviderId }
      : {}),
    reason: resolved.reason,
  }];
  if (input.policy.allowEquivalentModels) {
    const now = (input.now ?? new Date()).getTime();
    const group = input.council.groups.find((candidate) =>
      Date.parse(candidate.expiresAt) > now
      && candidate.evidence.length > 0
      && candidate.members.some((member) =>
        member.providerId === resolved.providerId && member.modelId === resolved.model));
    group?.members.filter((member) =>
      member.providerId !== resolved.providerId || member.modelId !== resolved.model)
      .sort((left, right) => left.rank - right.rank)
      .forEach((member) => targets.push({
        providerId: member.providerId,
        modelId: member.modelId,
        ...(member.effort ? { effort: member.effort } : {}),
        ...(member.transportPreferences
          ? { transportPreferences: member.transportPreferences }
          : {}),
        reason: 'equivalent',
      }));
  }

  let candidates = targets.flatMap((target) => {
    const targetProfile = modelProfiles.find((profile) =>
      profile.providerId === target.providerId && profile.modelId === target.modelId);
    if (!supportsCapabilities(targetProfile, input.request.requiredCapabilities)) return [];
    return input.accounts
      .filter((account) => account.readiness === 'ready'
        && account.targetProviderId === target.providerId
        && account.supportedModelIds.includes(target.modelId)
        && (!target.transportProviderId
          || target.transportProviderId === account.transportProviderId))
      .map((account): RankedRouteCandidate => ({
        account,
        target: {
          requestedModel: input.request.requestedModel,
          providerId: target.providerId,
          modelId: target.modelId,
          transportProviderId: account.transportProviderId,
          ...(target.effort ? { effort: target.effort } : {}),
          reason: target.reason,
        },
      }));
  });
  if (input.request.explicit) {
    candidates = candidates.filter((candidate) =>
      selectorMatches(input.request.explicit!, candidate, input.request.requestedModel));
  }
  const strategy = resolveRouteStrategy(input.policy, input.request);
  const preferredExactTransport = candidates
    .filter((candidate) => candidate.target.reason !== 'equivalent')
    .sort((left, right) => Date.parse(right.account.enrollmentCompletedAt)
      - Date.parse(left.account.enrollmentCompletedAt))[0]?.account.transportProviderId;
  const targetFor = (candidate: RankedRouteCandidate) => targets.find((target) =>
    target.providerId === candidate.target.providerId && target.modelId === candidate.target.modelId);
  candidates.sort((left, right) => {
    if (strategy.kind === 'ordered') {
      const rank = (candidate: RankedRouteCandidate) => strategy.preferences.findIndex(
        (selector) => selectorMatches(selector, candidate, input.request.requestedModel));
      const leftRank = rank(left); const rightRank = rank(right);
      if (leftRank !== rightRank) return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank)
        - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank);
    }
    const classRank = (candidate: RankedRouteCandidate) =>
      candidate.target.reason === 'equivalent' ? 1 : 0;
    if (classRank(left) !== classRank(right)) return classRank(left) - classRank(right);
    if (input.policy.preferSameTransport && classRank(left) === 1 && preferredExactTransport) {
      const sameTransportRank = (candidate: RankedRouteCandidate) =>
        candidate.account.transportProviderId === preferredExactTransport ? 0 : 1;
      if (sameTransportRank(left) !== sameTransportRank(right)) {
        return sameTransportRank(left) - sameTransportRank(right);
      }
    }
    const transportRank = (candidate: RankedRouteCandidate) => {
      const rank = targetFor(candidate)?.transportPreferences
        ?.indexOf(candidate.account.transportProviderId) ?? -1;
      return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
    };
    if (transportRank(left) !== transportRank(right)) return transportRank(left) - transportRank(right);
    return Date.parse(right.account.enrollmentCompletedAt)
      - Date.parse(left.account.enrollmentCompletedAt)
      || left.account.diagnosticAccountRef.localeCompare(right.account.diagnosticAccountRef);
  });
  if (strategy.kind === 'round-robin' && candidates.length > 1) {
    const offset = (input.roundRobinOffset ?? 0) % candidates.length;
    candidates = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  }
  return input.applyAttemptLimit === false
    ? candidates
    : candidates.slice(0, input.policy.maxAttempts);
};
