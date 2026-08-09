import type { ModelProfile } from './catalog.js';
import { GENERATED_MODEL_COUNCIL_SOURCE } from './generated-model-council.js';
import { LAUNCH_ALIAS_TARGET_MAPPINGS } from './routing-targets.js';

export type CapabilityName =
  | keyof ModelProfile['capabilities']
  | `input:${ModelProfile['capabilities']['modalities']['input'][number]}`
  | `output:${ModelProfile['capabilities']['modalities']['output'][number]}`;

export type CapabilityRequirement =
  | CapabilityName
  | { readonly capability: CapabilityName; readonly required: true }
  | { readonly capability: CapabilityName; readonly minimum: number };

export interface BenchmarkEvidence {
  readonly suite: string;
  readonly artifact: string;
  readonly measuredAt: string;
  readonly dimensions: Readonly<Record<string, number | string>>;
}

export interface ModelEquivalenceMember {
  readonly providerId: string;
  readonly modelId: string;
  readonly rank: number;
  readonly effort?: string;
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly transportPreferences?: readonly string[];
}

export interface ModelEquivalenceGroup {
  readonly id: string;
  readonly intent: 'coding' | 'general' | 'reasoning' | 'fast';
  readonly members: readonly ModelEquivalenceMember[];
  readonly evidence: readonly BenchmarkEvidence[];
  readonly expiresAt: string;
}

export interface ModelAlias {
  readonly alias: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId: string;
  readonly effort?: string;
}

export interface EquivalenceExclusion {
  readonly providerId: string;
  readonly modelId: string;
  readonly reason: string;
  readonly reviewer: string;
  readonly expiresAt: string;
  readonly provenance: string;
}

export interface ModelEquivalenceCouncil {
  readonly revision: string;
  readonly aliases: readonly ModelAlias[];
  readonly groups: readonly ModelEquivalenceGroup[];
  readonly exclusions: readonly EquivalenceExclusion[];
}

export class EquivalenceCouncilError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(issues.join('; '));
    this.name = 'EquivalenceCouncilError';
  }
}

const normalizedCapabilityRequirement = (requirement: CapabilityRequirement): {
  readonly capability: CapabilityName;
  readonly minimum?: number;
} => typeof requirement === 'string'
  ? { capability: requirement }
  : {
      capability: requirement.capability,
      ...('minimum' in requirement ? { minimum: requirement.minimum } : {}),
    };

export const capabilityRequirementEquals = (
  left: CapabilityRequirement,
  right: CapabilityRequirement,
): boolean => {
  const normalizedLeft = normalizedCapabilityRequirement(left);
  const normalizedRight = normalizedCapabilityRequirement(right);
  return normalizedLeft.capability === normalizedRight.capability
    && normalizedLeft.minimum === normalizedRight.minimum;
};

export const modelSupportsCapability = (
  profile: ModelProfile | undefined,
  requirement: CapabilityRequirement,
): boolean => {
  if (!profile) return false;
  const normalized = normalizedCapabilityRequirement(requirement);
  if (normalized.capability.startsWith('input:')) {
    return profile.capabilities.modalities.input.includes(
      normalized.capability.slice(6) as never,
    );
  }
  if (normalized.capability.startsWith('output:')) {
    return profile.capabilities.modalities.output.includes(
      normalized.capability.slice(7) as never,
    );
  }
  const capability = profile.capabilities[
    normalized.capability as keyof ModelProfile['capabilities']
  ];
  if (typeof capability === 'number') {
    return normalized.minimum === undefined
      ? capability > 0
      : capability >= normalized.minimum;
  }
  if (normalized.minimum !== undefined) return false;
  if (capability && typeof capability === 'object' && 'support' in capability) {
    return capability.support !== 'unsupported';
  }
  return capability !== undefined;
};

const aliases = Object.entries(LAUNCH_ALIAS_TARGET_MAPPINGS).map(([alias, target]) => ({
  alias,
  providerId: target.providerId,
  modelId: target.model,
  transportProviderId: target.transportProviderId,
  ...(target.effort ? { effort: target.effort } : {}),
}));

export const DEFAULT_MODEL_EQUIVALENCE_COUNCIL: ModelEquivalenceCouncil = {
  revision: GENERATED_MODEL_COUNCIL_SOURCE.revision,
  aliases,
  groups: [],
  exclusions: GENERATED_MODEL_COUNCIL_SOURCE.excludedModelKeys.map((key) => {
    const separator = key.indexOf(':');
    return {
      providerId: key.slice(0, separator),
      modelId: key.slice(separator + 1),
      reason: GENERATED_MODEL_COUNCIL_SOURCE.reason,
      reviewer: GENERATED_MODEL_COUNCIL_SOURCE.reviewer,
      expiresAt: GENERATED_MODEL_COUNCIL_SOURCE.expiresAt,
      provenance: `${GENERATED_MODEL_COUNCIL_SOURCE.provenance}#${GENERATED_MODEL_COUNCIL_SOURCE.digest}`,
    };
  }),
};

export const validateEquivalenceCouncil = (
  council: ModelEquivalenceCouncil,
  profiles: readonly ModelProfile[],
  now: Date = new Date(),
): void => {
  const issues: string[] = [];
  const profilesByKey = new Map(
    profiles.map((profile) => [`${profile.providerId}:${profile.modelId}`, profile]),
  );
  const classified = new Map<string, number>();
  const add = (providerId: string, modelId: string) => {
    const key = `${providerId}:${modelId}`;
    classified.set(key, (classified.get(key) ?? 0) + 1);
  };
  council.groups.forEach((group) => {
    if (group.evidence.length === 0) issues.push(`group has no evidence: ${group.id}`);
    if (Date.parse(group.expiresAt) <= now.getTime()) issues.push(`expired group ${group.id}`);
    group.members.forEach((member) => {
      add(member.providerId, member.modelId);
      const key = `${member.providerId}:${member.modelId}`;
      const profile = profilesByKey.get(key);
      if (!profile) issues.push(`unknown council model: ${key}`);
      for (const requirement of member.requiredCapabilities) {
        if (!modelSupportsCapability(profile, requirement)) {
          issues.push(`missing capability ${requirement}: ${key}`);
        }
      }
    });
  });
  council.exclusions.forEach((exclusion) => {
    add(exclusion.providerId, exclusion.modelId);
    if (Date.parse(exclusion.expiresAt) <= now.getTime()) {
      issues.push(`expired exclusion ${exclusion.providerId}:${exclusion.modelId}`);
    }
    if (!profilesByKey.has(`${exclusion.providerId}:${exclusion.modelId}`)) {
      issues.push(`unknown excluded model: ${exclusion.providerId}:${exclusion.modelId}`);
    }
  });
  for (const profile of profiles) {
    const key = `${profile.providerId}:${profile.modelId}`;
    if (classified.get(key) !== 1) issues.push(`model must be classified exactly once: ${key}`);
  }
  if (issues.length > 0) throw new EquivalenceCouncilError(issues);
};
