import type { ModelProfile } from './catalog.js';
import { LAUNCH_ALIAS_TARGET_MAPPINGS } from './routing-targets.js';

export type CapabilityRequirement =
  | keyof ModelProfile['capabilities']
  | `input:${ModelProfile['capabilities']['modalities']['input'][number]}`
  | `output:${ModelProfile['capabilities']['modalities']['output'][number]}`;

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

const excludedModelKeys = [
  'openai:gpt-5.6-sol', 'openai:gpt-5.6-terra', 'openai:gpt-5.6-luna',
  'openai:gpt-5.5', 'openai:gpt-5.4-nano', 'openai:gpt-4.1-nano',
  'gemini:gemini-3.5-flash', 'gemini:gemini-3.1-flash-lite',
  'anthropic:claude-sonnet-5', 'anthropic:claude-opus-5',
  'anthropic:claude-opus-4-8', 'anthropic:claude-fable-5',
  'mistral:mistral-small-2603', 'mistral:magistral-medium-2509',
  'cohere:command-a-03-2025', 'cohere:command-a-reasoning-08-2025',
  'gcp:google/gemini-3.5-flash@gcp', 'gcp:google/gemini-3.1-flash-lite@gcp',
  'gcp:anthropic/claude-sonnet-4-6@gcp', 'gcp:anthropic/claude-opus-4-6@gcp',
] as const;

const aliases = Object.entries(LAUNCH_ALIAS_TARGET_MAPPINGS).map(([alias, target]) => ({
  alias,
  providerId: target.providerId,
  modelId: target.model,
  transportProviderId: target.transportProviderId,
  ...(target.effort ? { effort: target.effort } : {}),
}));

export const DEFAULT_MODEL_EQUIVALENCE_COUNCIL: ModelEquivalenceCouncil = {
  revision: '2026-08-08.1',
  aliases,
  groups: [],
  exclusions: excludedModelKeys.map((key) => {
    const separator = key.indexOf(':');
    return {
      providerId: key.slice(0, separator),
      modelId: key.slice(separator + 1),
      reason: 'No pinned benchmark evidence authorizes automatic substitution.',
      reviewer: 'BR-73 model council',
      expiresAt: '2027-02-08T00:00:00.000Z',
      provenance: 'spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md',
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
        const supported = requirement.startsWith('input:')
          ? profile?.capabilities.modalities.input.includes(requirement.slice(6) as never)
          : requirement.startsWith('output:')
            ? profile?.capabilities.modalities.output.includes(requirement.slice(7) as never)
            : profile?.capabilities[requirement as keyof ModelProfile['capabilities']] !== undefined;
        if (!supported) issues.push(`missing capability ${requirement}: ${key}`);
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
