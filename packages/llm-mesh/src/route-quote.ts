import { modelProfiles, providerProfiles } from './catalog.js';
import {
  DEFAULT_MODEL_EQUIVALENCE_COUNCIL, type ModelEquivalenceCouncil,
} from './equivalence-council.js';
import { mergeRoutePolicy, RoutePlanError } from './route-planner-state.js';
import { resolveRouteTargets } from './route-selection.js';
import type {
  PlannedRouteTarget, QuotedRouteCandidate, RoutePlanInput, RouteQuote, RouteQuoteErrorCode,
  RouteQuoteInput, RouteUsageCeiling,
} from './routing-contracts.js';
import {
  DEFAULT_ROUTE_POLICY, InMemoryRoutePolicyProfiles, resolveRoutePolicy, validateRoutePolicy,
  type RoutePolicy, type RoutePolicyProfile,
} from './routing-policy.js';
import { resolveTargetCapabilitySource } from './routing-targets.js';

export const MAX_ROUTE_QUOTE_CANDIDATES = 16;

/** Transports that cannot apply a caller output ceiling (the Codex wire omits it). */
const OUTPUT_CEILING_UNENFORCED_TRANSPORTS: readonly string[] = ['codex'];

export class RouteQuoteError extends Error {
  constructor(message: string, readonly code: RouteQuoteErrorCode) {
    super(message);
    this.name = 'RouteQuoteError';
  }
}

export interface RouteQuoteOptions {
  readonly council?: ModelEquivalenceCouncil;
  readonly profiles?: InMemoryRoutePolicyProfiles;
}

type QuoteRouteFields = Pick<RoutePlanInput, 'targetCandidatesOverride' | 'intent'
  | 'requiredCapabilities' | 'policyProfile' | 'policyOverride' | 'explicit'>;
type QuoteBody = Omit<RouteQuote, 'quoteRef'>;

interface QuoteTarget {
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId?: string;
  readonly reason: PlannedRouteTarget['reason'];
}

const isCount = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum;

const validateCeiling = (ceiling: RouteUsageCeiling | undefined, now: Date | undefined): void => {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RouteQuoteError('Quote clock value must be a valid Date', 'invalid-ceiling');
  }
  if (!ceiling || !isCount(ceiling.inputTokens, 0) || !isCount(ceiling.outputTokens, 1)) {
    throw new RouteQuoteError('Usage ceiling requires finite input >= 0 and output >= 1', 'invalid-ceiling');
  }
  for (const key of ['reasoningTokens', 'imageUnits', 'toolCalls'] as const) {
    if (ceiling[key] !== undefined && !isCount(ceiling[key], 0)) {
      throw new RouteQuoteError(`Usage ceiling ${key} must be a finite integer >= 0`, 'invalid-ceiling');
    }
  }
};

/** Resolves the policy exactly as `plan()` does, without touching any account. */
export const resolveQuotePolicy = (
  input: RoutePlanInput,
  profiles: InMemoryRoutePolicyProfiles,
): { readonly profile?: RoutePolicyProfile; readonly policy: RoutePolicy } => {
  const profile = input.policyProfile
    ? profiles.list().find((entry) => entry.name === input.policyProfile)
    : profiles.active();
  if (input.policyProfile && !profile) throw new RoutePlanError('Unknown policy profile', 'no-route');
  const policy = resolveRoutePolicy(
    mergeRoutePolicy(profile?.policy ?? DEFAULT_ROUTE_POLICY, input.policyOverride), input,
  );
  validateRoutePolicy(policy);
  return { ...(profile ? { profile } : {}), policy };
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
};

// FNV-1a 64-bit: a deterministic consistency reference, not an authentication tag.
const digest = (text: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
};

/** Deterministic quote reference over route input fields, resolved profile and quoted body. */
export const computeRouteQuoteRef = (
  input: QuoteRouteFields,
  policyProfileName: string | undefined,
  body: QuoteBody,
): string => `quote_${digest(JSON.stringify(canonical({
  version: 1,
  route: {
    targetCandidatesOverride: input.targetCandidatesOverride,
    intent: input.intent,
    // Order-insensitive: the capability filter is a conjunction.
    requiredCapabilities: input.requiredCapabilities
      ?.map((entry) => JSON.stringify(canonical(entry))).sort(),
    policyProfile: input.policyProfile,
    policyOverride: input.policyOverride,
    explicit: input.explicit,
  },
  policyProfileName: policyProfileName ?? null,
  requestedModel: body.requestedModel,
  candidates: body.candidates,
  maxAttempts: body.maxAttempts,
  quotedAt: body.quotedAt,
  policyRevision: body.policyRevision,
  councilRevision: body.councilRevision,
})))}`;

/** True when a planned target is covered by a quoted candidate. */
export const isQuotedRouteTarget = (
  quote: RouteQuote,
  target: Pick<PlannedRouteTarget, 'providerId' | 'modelId' | 'transportProviderId'>,
): boolean => quote.candidates.some((candidate) =>
  candidate.providerId === target.providerId
  && candidate.modelId === target.modelId
  && (candidate.transportProviderId === undefined
    || candidate.transportProviderId === target.transportProviderId));

const profileFor = (target: QuoteTarget) => {
  const source = resolveTargetCapabilitySource({
    providerId: target.providerId,
    transportProviderId: target.transportProviderId ?? '',
    model: target.modelId,
  });
  return modelProfiles.find((profile) =>
    profile.providerId === source.providerId && profile.modelId === source.model);
};

const mayUseUnenforcedTransport = (target: QuoteTarget): boolean => {
  if (target.transportProviderId !== undefined) {
    return OUTPUT_CEILING_UNENFORCED_TRANSPORTS.includes(target.transportProviderId);
  }
  const provider = (providerProfiles as Record<string, {
    capabilities: { auth: { accountTransports: readonly string[] } };
  } | undefined>)[target.providerId];
  // Unpinned: any enrolled transport of the provider may serve the attempt.
  return provider?.capabilities.auth.accountTransports
    .some((transport) => OUTPUT_CEILING_UNENFORCED_TRANSPORTS.includes(transport)) ?? false;
};

const resolveQuoteTargets = (
  input: RouteQuoteInput,
  policy: RoutePolicy,
  council: ModelEquivalenceCouncil,
): QuoteTarget[] => {
  const resolution = resolveRouteTargets(input, policy, council, input.now);
  if (resolution.kind === 'unknown-model') {
    throw new RouteQuoteError('Unknown requested model', 'unknown-model');
  }
  if (resolution.kind === 'capabilities-unmet') {
    throw new RouteQuoteError('Required capabilities are unavailable', 'capabilities-unmet');
  }
  // Account-independent part of an explicit selector; the account selector only narrows plan().
  const explicit = input.explicit;
  const selected: QuoteTarget[] = explicit
    ? resolution.capableTargets
      .filter((target) => (!explicit.providerId || explicit.providerId === target.providerId)
        && (!explicit.modelId || explicit.modelId === target.modelId)
        && (!explicit.alias || explicit.alias === input.requestedModel)
        && (!explicit.transportProviderId || target.transportProviderId === undefined
          || explicit.transportProviderId === target.transportProviderId))
      .map((target) => (explicit.transportProviderId
        ? { ...target, transportProviderId: explicit.transportProviderId }
        : target))
    : [...resolution.capableTargets];
  const seen = new Set<string>();
  return selected.filter((target) => {
    const key = `${target.providerId}\u001f${target.modelId}\u001f${target.transportProviderId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const freezeQuote = (quote: RouteQuote): RouteQuote => {
  quote.candidates.forEach((candidate) => {
    Object.freeze(candidate.allowance);
    Object.freeze(candidate);
  });
  Object.freeze(quote.candidates);
  return Object.freeze(quote);
};

/**
 * Side-effect-free candidate and usage bounds for a request: every model any
 * plan could pick (a superset, independent of accounts and health), the
 * attempt cap and per-attempt allowances. Synchronous, no I/O, no clock read.
 */
export const quoteRoute = (input: RouteQuoteInput, options: RouteQuoteOptions = {}): RouteQuote => {
  validateCeiling(input.ceiling, input.now);
  const council = options.council ?? DEFAULT_MODEL_EQUIVALENCE_COUNCIL;
  const { profile, policy } = resolveQuotePolicy(
    input, options.profiles ?? new InMemoryRoutePolicyProfiles(),
  );
  const targets = resolveQuoteTargets(input, policy, council);
  if (targets.length > MAX_ROUTE_QUOTE_CANDIDATES) {
    throw new RouteQuoteError(
      `Route has ${targets.length} candidates; the quote limit is ${MAX_ROUTE_QUOTE_CANDIDATES}`,
      'too-many-candidates',
    );
  }
  const { ceiling } = input;
  const candidates = targets.map((target): QuotedRouteCandidate => {
    const modelCapabilities = profileFor(target)?.capabilities;
    const contextWindow = modelCapabilities?.contextWindowTokens;
    if (contextWindow !== undefined && ceiling.inputTokens > contextWindow) {
      throw new RouteQuoteError(
        `Input ceiling exceeds the ${target.modelId} context window`, 'invalid-ceiling',
      );
    }
    const maxOutput = modelCapabilities?.maxOutputTokens;
    return {
      providerId: target.providerId,
      modelId: target.modelId,
      ...(target.transportProviderId ? { transportProviderId: target.transportProviderId } : {}),
      reason: target.reason,
      allowance: {
        inputTokens: ceiling.inputTokens,
        outputTokens: maxOutput === undefined
          ? ceiling.outputTokens
          : Math.min(ceiling.outputTokens, maxOutput),
        ...(ceiling.reasoningTokens !== undefined ? { reasoningTokens: ceiling.reasoningTokens } : {}),
        ...(ceiling.imageUnits !== undefined ? { imageUnits: ceiling.imageUnits } : {}),
        ...(ceiling.toolCalls !== undefined ? { toolCalls: ceiling.toolCalls } : {}),
      },
      outputCeilingEnforced: !mayUseUnenforcedTransport(target),
    };
  });
  const body: QuoteBody = {
    requestedModel: input.requestedModel,
    candidates,
    maxAttempts: policy.maxAttempts,
    quotedAt: input.now.toISOString(),
    policyRevision: profile?.revision ?? 'default',
    councilRevision: council.revision,
  };
  return freezeQuote({ quoteRef: computeRouteQuoteRef(input, profile?.name, body), ...body });
};
