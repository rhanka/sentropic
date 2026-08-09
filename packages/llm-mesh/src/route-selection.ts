import { modelProfiles, type ModelProfile } from './catalog.js';
import {
  modelSupportsCapability, type ModelEquivalenceCouncil,
} from './equivalence-council.js';
import type { EligibleAccountDescriptor, PlannedRouteTarget, RoutePlanInput } from './routing-contracts.js';
import type { RoutePolicy, RouteSelector, RouteStrategy } from './routing-policy.js';
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

const strategyFor = (policy: RoutePolicy, input: RoutePlanInput): RouteStrategy => {
  const rule = policy.rules.find((candidate) =>
    (!candidate.match.requestedModel || candidate.match.requestedModel === input.requestedModel)
    && (!candidate.match.alias || candidate.match.alias === input.requestedModel)
    && (!candidate.match.capabilities || candidate.match.capabilities.every(
      (capability) => input.requiredCapabilities?.includes(capability),
    )));
  if (rule?.strategy) return rule.strategy;
  if (rule?.preferences) return { kind: 'ordered', preferences: rule.preferences };
  return policy.strategy;
};

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
    const group = input.council.groups.find((candidate) => candidate.members.some((member) =>
      member.providerId === resolved.providerId && member.modelId === resolved.model));
    group?.members.filter((member) =>
      member.providerId !== resolved.providerId || member.modelId !== resolved.model)
      .sort((left, right) => left.rank - right.rank)
      .forEach((member) => targets.push({
        providerId: member.providerId,
        modelId: member.modelId,
        ...(member.effort ? { effort: member.effort } : {}),
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
  const strategy = strategyFor(input.policy, input.request);
  candidates.sort((left, right) => {
    if (strategy.kind === 'ordered') {
      const rank = (candidate: RankedRouteCandidate) => strategy.preferences.findIndex(
        (selector) => selectorMatches(selector, candidate, input.request.requestedModel));
      const leftRank = rank(left); const rightRank = rank(right);
      if (leftRank !== rightRank) return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank)
        - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank);
    }
    return Date.parse(right.account.enrollmentCompletedAt)
      - Date.parse(left.account.enrollmentCompletedAt)
      || left.account.diagnosticAccountRef.localeCompare(right.account.diagnosticAccountRef);
  });
  if (strategy.kind === 'round-robin' && candidates.length > 1) {
    const offset = (input.roundRobinOffset ?? 0) % candidates.length;
    candidates = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  }
  return candidates.slice(0, input.policy.maxAttempts);
};
