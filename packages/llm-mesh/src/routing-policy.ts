import {
  capabilityRequirementEquals, type CapabilityRequirement,
} from './equivalence-council.js';
import type { RoutePlanInput } from './routing-contracts.js';

export interface RouteSelector {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly alias?: string;
  readonly transportProviderId?: string;
  readonly diagnosticAccountRef?: string;
}

export type RouteStrategy =
  | { readonly kind: 'last-enrolled' }
  | { readonly kind: 'ordered'; readonly preferences: readonly RouteSelector[] }
  | { readonly kind: 'round-robin'; readonly scope: 'new-affinity' };

export interface RouteRule {
  readonly match: {
    readonly requestedModel?: string;
    readonly alias?: string;
    readonly intent?: 'coding' | 'general' | 'reasoning' | 'fast';
    readonly capabilities?: readonly CapabilityRequirement[];
  };
  readonly strategy?: RouteStrategy;
  readonly preferences?: readonly RouteSelector[];
  readonly fallback?: {
    readonly fallbackMode?: RoutePolicy['fallbackMode'];
    readonly allowEquivalentModels?: boolean;
    readonly rotateEquivalentAccounts?: boolean;
  };
}

export interface RoutePolicy {
  readonly strategy: RouteStrategy;
  readonly rules: readonly RouteRule[];
  readonly fallbackMode: 'retest-preferred' | 'one-way';
  readonly negativeCacheTtlMs: number;
  readonly maxAttempts: number;
  readonly preferSameTransport: boolean;
  readonly stickyAccount: boolean;
  readonly rotateEquivalentAccounts: boolean;
  readonly allowEquivalentModels: boolean;
}

export interface RoutePolicyProfile {
  readonly name: string;
  readonly revision: string;
  readonly policy: RoutePolicy;
}

export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  strategy: { kind: 'last-enrolled' },
  rules: [],
  fallbackMode: 'retest-preferred',
  negativeCacheTtlMs: 300_000,
  maxAttempts: 3,
  preferSameTransport: true,
  stickyAccount: true,
  rotateEquivalentAccounts: false,
  allowEquivalentModels: true,
};

export class RoutePolicyError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(issues.join('; '));
    this.name = 'RoutePolicyError';
  }
}

const validateStrategy = (strategy: RouteStrategy, path: string, issues: string[]): void => {
  if (strategy.kind === 'ordered' && strategy.preferences.length === 0) {
    issues.push(`${path}.preferences must not be empty`);
  }
  if (strategy.kind === 'round-robin' && strategy.scope !== 'new-affinity') {
    issues.push(`${path}.scope must be new-affinity`);
  }
};

export const validateRoutePolicy = (policy: RoutePolicy): void => {
  const issues: string[] = [];
  if (policy.negativeCacheTtlMs < 1_000 || policy.negativeCacheTtlMs > 3_600_000) {
    issues.push('negativeCacheTtlMs must be between 1000 and 3600000');
  }
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 8) {
    issues.push('maxAttempts must be an integer between 1 and 8');
  }
  validateStrategy(policy.strategy, 'strategy', issues);
  policy.rules.forEach((rule, index) => {
    if (Object.keys(rule.match).length === 0) issues.push(`rules[${index}].match must not be empty`);
    if (rule.strategy) validateStrategy(rule.strategy, `rules[${index}].strategy`, issues);
  });
  if (issues.length > 0) throw new RoutePolicyError(issues);
};

export const describeRoutePolicy = (policy: RoutePolicy): string =>
  JSON.stringify(policy);

export const resolveRoutePolicy = (
  policy: RoutePolicy,
  input: RoutePlanInput,
): RoutePolicy => {
  const rule = policy.rules.find((candidate) =>
    (!candidate.match.requestedModel || candidate.match.requestedModel === input.requestedModel)
    && (!candidate.match.alias || candidate.match.alias === input.requestedModel)
    && (!candidate.match.intent || candidate.match.intent === input.intent)
    && (!candidate.match.capabilities || candidate.match.capabilities.every(
      (capability) => input.requiredCapabilities?.some(
        (required) => capabilityRequirementEquals(required, capability),
      ),
    )));
  return rule?.fallback ? { ...policy, ...rule.fallback } : policy;
};

export const resolveRouteStrategy = (
  policy: RoutePolicy,
  input: RoutePlanInput,
): RouteStrategy => {
  const rule = policy.rules.find((candidate) =>
    (!candidate.match.requestedModel || candidate.match.requestedModel === input.requestedModel)
    && (!candidate.match.alias || candidate.match.alias === input.requestedModel)
    && (!candidate.match.intent || candidate.match.intent === input.intent)
    && (!candidate.match.capabilities || candidate.match.capabilities.every(
      (capability) => input.requiredCapabilities?.some(
        (required) => capabilityRequirementEquals(required, capability),
      ),
    )));
  if (rule?.strategy) return rule.strategy;
  if (rule?.preferences) return { kind: 'ordered', preferences: rule.preferences };
  return policy.strategy;
};

export class InMemoryRoutePolicyProfiles {
  private readonly profiles = new Map<string, RoutePolicyProfile>();
  private activeName?: string;

  constructor(profiles: readonly RoutePolicyProfile[] = []) {
    profiles.forEach((profile) => this.set(profile));
  }

  set(profile: RoutePolicyProfile): void {
    validateRoutePolicy(profile.policy);
    this.profiles.set(profile.name, profile);
  }

  list(): readonly RoutePolicyProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  activate(name: string, expectedRevision?: string): RoutePolicyProfile {
    const profile = this.profiles.get(name);
    if (!profile) throw new RoutePolicyError([`unknown profile: ${name}`]);
    if (expectedRevision && profile.revision !== expectedRevision) {
      throw new RoutePolicyError([`profile revision changed: ${name}`]);
    }
    this.activeName = name;
    return profile;
  }

  active(): RoutePolicyProfile | undefined {
    return this.activeName ? this.profiles.get(this.activeName) : undefined;
  }
}
