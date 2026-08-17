import { modelProfiles, type ModelProfile } from './catalog.js';
import { modelSupportsCapability, type ModelEquivalenceCouncil } from './equivalence-council.js';
import type { EligibleAccountDescriptor, PlannedRouteTarget, RoutePlanInput } from './routing-contracts.js';
import { resolveRouteStrategy, type RoutePolicy, type RouteSelector } from './routing-policy.js';
import {
  createCanonicalTargetCandidatesResolver, resolveTargetCapabilitySource,
} from './routing-targets.js';
export interface RankedRouteCandidate {
  readonly account: EligibleAccountDescriptor;
  readonly target: PlannedRouteTarget;
}

export type RouteCandidateSelection =
  | { readonly kind: 'candidates'; readonly candidates: readonly RankedRouteCandidate[] }
  | { readonly kind: 'unknown-model'; readonly requestedModel: string }
  | { readonly kind: 'capabilities-unmet'; readonly requestedModel: string }
  | { readonly kind: 'no-eligible-account'; readonly requestedModel: string };

interface ResolvedRouteTarget {
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId?: string;
  readonly effort?: string;
  readonly transportPreferences?: readonly string[];
  readonly reason: PlannedRouteTarget['reason'];
}
const resolveCanonicalTargets = createCanonicalTargetCandidatesResolver();
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

type RequestedTargetResolution =
  | { readonly kind: 'known'; readonly targets: readonly {
  providerId: string;
  model: string;
  transportProviderId?: string;
  effort?: string;
  reason: 'exact' | 'alias';
}[]; readonly useFaithfulAnthropicTarget: boolean }
  | { readonly kind: 'unknown-model'; readonly requestedModel: string };

const sameTarget = (left: {
  readonly providerId: string; readonly transportProviderId?: string; readonly model: string;
  readonly effort?: string;
}, right: {
  readonly providerId: string; readonly transportProviderId?: string; readonly model: string;
  readonly effort?: string;
}): boolean => left.providerId === right.providerId
  && left.transportProviderId === right.transportProviderId
  && left.model === right.model
  && left.effort === right.effort;

const resolveRequestedTargets = (request: RoutePlanInput): RequestedTargetResolution => {
  const { requestedModel } = request;
  const canonicalTargets = resolveCanonicalTargets(requestedModel);
  const profile = modelProfiles.find((candidate) => candidate.modelId === requestedModel);
  if (canonicalTargets.length === 0 && !profile) {
    return { kind: 'unknown-model', requestedModel };
  }
  const standardTargets = canonicalTargets.length > 0
    ? canonicalTargets
    : [{ providerId: profile!.providerId, model: profile!.modelId, transportProviderId: undefined }];
  const faithfulClaudeTarget = requestedModel.startsWith('claude-')
    ? standardTargets.find((target) => target.providerId === 'anthropic')
    : undefined;
  const useFaithfulAnthropicTarget = faithfulClaudeTarget
    && modelProfiles.some((profile) => profile.providerId === faithfulClaudeTarget.providerId
      && profile.modelId === faithfulClaudeTarget.model);
  const override = request.targetCandidatesOverride;
  const targets = override && useFaithfulAnthropicTarget
    ? [
      faithfulClaudeTarget,
      ...override.filter((target) => !sameTarget(faithfulClaudeTarget, target)),
    ]
    : override ?? standardTargets;
  return {
    kind: 'known',
    targets: targets.map((target) => ({
    ...target,
    reason: requestedModel === target.model ? 'exact' as const : 'alias' as const,
    })),
    useFaithfulAnthropicTarget: Boolean(useFaithfulAnthropicTarget),
  };
};

export const selectRouteCandidates = (input: {
  readonly request: RoutePlanInput;
  readonly policy: RoutePolicy;
  readonly council: ModelEquivalenceCouncil;
  readonly accounts: readonly EligibleAccountDescriptor[];
  readonly roundRobinOffset?: number;
  readonly now?: Date;
  readonly applyAttemptLimit?: boolean;
}): RouteCandidateSelection => {
  const resolution = resolveRequestedTargets(input.request);
  if (resolution.kind === 'unknown-model') return resolution;
  const targets: ResolvedRouteTarget[] = resolution.targets.map((resolved) => ({
    providerId: resolved.providerId,
    modelId: resolved.model,
    ...(resolved.effort ? { effort: resolved.effort } : {}),
    ...(resolved.transportProviderId
      ? { transportProviderId: resolved.transportProviderId }
      : {}),
    reason: resolved.reason,
  }));
  if (input.policy.allowEquivalentModels) {
    const now = (input.now ?? new Date()).getTime();
    for (const resolved of resolution.targets) {
      const group = input.council.groups.find((candidate) =>
        Date.parse(candidate.expiresAt) > now
        && candidate.evidence.length > 0
        && candidate.members.some((member) =>
          member.providerId === resolved.providerId && member.modelId === resolved.model));
      group?.members.filter((member) =>
        !targets.some((target) => target.providerId === member.providerId
          && target.modelId === member.modelId))
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
  }

  const supportsTargetCapabilities = (target: ResolvedRouteTarget): boolean => {
    const capabilitySource = resolveTargetCapabilitySource({
      providerId: target.providerId,
      transportProviderId: target.transportProviderId ?? '',
      model: target.modelId,
    });
    const targetProfile = modelProfiles.find((profile) =>
      profile.providerId === capabilitySource.providerId
      && profile.modelId === capabilitySource.model);
    return supportsCapabilities(targetProfile, input.request.requiredCapabilities);
  };
  const faithfulClaude = resolution.kind === 'known'
    && input.request.requestedModel.startsWith('claude-')
    && resolution.useFaithfulAnthropicTarget;
  if (faithfulClaude && targets[0] && !supportsTargetCapabilities(targets[0])) {
    return { kind: 'capabilities-unmet', requestedModel: input.request.requestedModel };
  }
  const capableTargets = targets.filter(supportsTargetCapabilities);
  if (!faithfulClaude && targets.length > 0 && capableTargets.length === 0) {
    return { kind: 'capabilities-unmet', requestedModel: input.request.requestedModel };
  }
  const candidatesFor = (target: ResolvedRouteTarget): RankedRouteCandidate[] => input.accounts
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
  let candidates: RankedRouteCandidate[] = [];
  for (const target of capableTargets) {
    const candidatesForTarget = candidatesFor(target);
    if (candidatesForTarget.length > 0) {
      candidates = faithfulClaude ? candidatesForTarget : [...candidates, ...candidatesForTarget];
      if (faithfulClaude) break;
    }
  }
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
  const selected = input.applyAttemptLimit === false
    ? candidates
    : candidates.slice(0, input.policy.maxAttempts);
  return selected.length > 0
    ? { kind: 'candidates', candidates: selected }
    : { kind: 'no-eligible-account', requestedModel: input.request.requestedModel };
};
