import { modelProfiles } from './catalog.js';

export interface TargetMapping {
  readonly providerId: string;
  readonly transportProviderId: string;
  readonly model: string;
  readonly effort?: string;
}

export interface LaunchAliasDefinition extends TargetMapping {
  readonly alias: string;
}

export interface TargetRouteDescription extends TargetMapping {
  readonly requestedId: string;
  readonly kind: 'faithful' | 'alias';
}

export type ModelTargetResolver = (model: string) => TargetMapping | undefined;
export type ModelTargetCandidatesResolver = (
  model: string,
) => readonly TargetMapping[];

export const defineLaunchAliases = (
  definitions: readonly LaunchAliasDefinition[],
): Readonly<Record<string, TargetMapping>> => Object.fromEntries(
  definitions.map(({ alias, ...target }) => [alias, target]),
);

export const MUSE_CONTRIBUTOR_MODEL = 'muse-spark-1.3-contributor';

/**
 * Vibe CLI wire API name (spec §16.8, UAT `904e8d8f3`). Vibe `2.26.1` sends
 * its internal API name, not the display alias. This pinned gateway
 * compatibility alias serves the existing `mistral-medium-3.5` catalog target
 * over `mistral-vibe`; it is not a new model profile, pricing row, or
 * equivalence member. Update the pinned Vibe fixture in the same change when
 * the wire name or target changes.
 */
export const VIBE_CLI_WIRE_MODEL = 'mistral-vibe-cli-latest';

export const DEFAULT_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> = {
  'muse-spark-1.3': {
    providerId: 'muse', transportProviderId: 'muse', model: 'muse-spark-1.3',
  },
  'muse-spark-1.3-contributor': {
    providerId: 'muse', transportProviderId: 'muse', model: MUSE_CONTRIBUTOR_MODEL,
  },
  'muse-wonder-1.0': {
    providerId: 'muse', transportProviderId: 'muse', model: 'muse-wonder-1.0',
  },
  'muse-wonder-full-1.0': {
    providerId: 'muse', transportProviderId: 'muse', model: 'muse-wonder-full-1.0',
  },
  'claude-sonnet-5': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-5',
  },
  'claude-opus-5': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-opus-5',
  },
  'claude-opus-4-8': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-opus-4-8',
  },
  'claude-fable-5': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-fable-5',
  },
  'claude-fable-5-1': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-fable-5-1',
  },
  'gpt-5.6-luna': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-luna',
  },
  'gpt-6-luna': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-6-luna',
  },
  'gpt-5.6-sol': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol',
  },
  'gpt-6-sol': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-6-sol',
  },
  'gpt-6.1-sol': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-6.1-sol',
  },
  'gpt-6-astra': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-6-astra',
  },
  'gemini-3.7-flash': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
  },
  'gemini-3.8-flash': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.8-flash',
  },
  'gemini-4-argon': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-4-argon',
  },
  'gpt-5.6-terra': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra',
  },
  // Mistral Vibe faithful routes: these models are served on api.mistral.ai by
  // the plan-billed `mistral-vibe` account transport. `mistral-medium-3.5` is
  // the Vibe CLI default alias — the static mapping pins its faithful
  // transport (catalog-profile recognition alone would also resolve it, so
  // this entry preserves the historical combined mapping/catalog gap fix).
  'mistral-medium-3.5': {
    providerId: 'mistral', transportProviderId: 'mistral-vibe', model: 'mistral-medium-3.5',
  },
  // Pinned Vibe CLI wire alias (spec §16.8): the single definition of the
  // `mistral-vibe-cli-latest` compatibility alias, referencing the canonical
  // target above. All resolver variants consume it from this table.
  [VIBE_CLI_WIRE_MODEL]: {
    providerId: 'mistral', transportProviderId: 'mistral-vibe', model: 'mistral-medium-3.5',
  },
  'mistral-large-4': {
    providerId: 'mistral', transportProviderId: 'mistral-vibe', model: 'mistral-large-4',
  },
  'zai-glm-5-3': {
    providerId: 'mistral', transportProviderId: 'mistral-vibe', model: 'zai-glm-5-3',
  },
};

export interface StandardRouteDefinition {
  readonly requestedId: string;
  readonly codexModel: string;
  readonly cloudModel: string;
  readonly effort?: string;
  /** Codex-candidate effort override; defaults to the route effort. */
  readonly codexEffort?: string;
  /** Cloud-candidate effort override; defaults to the route effort. */
  readonly cloudEffort?: string;
}

/**
 * Muse serving model per launch alias (owner request 2026-10-15, Artificial
 * Analysis Intelligence Index, source artificialanalysis.ai/leaderboards/models,
 * read 2026-10-15: Claude Opus 5.5 max 58 / xhigh 56 / high 54 / medium 51 /
 * low 42; Sonnet 5.5 max 56 / xhigh 52 / high 47 / medium 41 / low 36;
 * Fable 5.1 max 53 / xhigh 53 / high 51 / medium 49 / low 47;
 * Gemini 4 Argon high 53 (low/medium unpublished); Gemini 3.8 Flash high 41 /
 * medium 40 / low 33; Muse Wonder Full max 56; Muse Wonder max 52;
 * Muse Spark 1.3 max 48 / xhigh 45). Wonder Full serves the top Opus 5.5 and
 * Sonnet 5.5 rows, Wonder serves the mid Opus 5.5 rows, Sonnet 5.5 xhigh and
 * the Fable 5.1 family, Spark keeps the remaining Sonnet 5.5 and low rows.
 * No `-contributor` Wonder variants exist in the catalog, so the Wonder slots
 * use the plain ids while the BR75-Q3 contributor tier default still applies
 * to Spark via MUSE_CONTRIBUTOR_MODEL. Aliases absent from this map keep the
 * Spark contributor. Efforts stay in MUSE_ROUTE_EFFORT (unchanged).
 */
export const MUSE_ROUTE_MODEL: Readonly<Record<string, string>> = {
  'claude-opus-5-5': 'muse-wonder-1.0',
  'claude-opus-5-5-high': 'muse-wonder-1.0',
  'claude-opus-5-5-xhigh': 'muse-wonder-full-1.0',
  'claude-opus-5-5-max': 'muse-wonder-full-1.0',
  'claude-opus-5-5-medium': 'muse-wonder-1.0',
  'claude-sonnet-5-5-xhigh': 'muse-wonder-1.0',
  'claude-sonnet-5-5-max': 'muse-wonder-full-1.0',
  'claude-fable-5-1': 'muse-wonder-1.0',
  'claude-fable-5-1-high': 'muse-wonder-1.0',
  'claude-fable-5-1-xhigh': 'muse-wonder-1.0',
  'claude-fable-5-1-max': 'muse-wonder-1.0',
  'claude-fable-5-1-medium': 'muse-wonder-1.0',
  'claude-fable-5-1-low': 'muse-wonder-1.0',
};

/**
 * Muse insertion effort per launch alias (BR75-D1). Aliases absent from this
 * map get no muse candidate. Tier default is contributor (BR75-Q3).
 */
export const MUSE_ROUTE_EFFORT: Readonly<Record<string, string>> = {
  'claude-fable-5': 'max',
  'claude-fable-5-high': 'max',
  'claude-fable-5-xhigh': 'max',
  'claude-fable-5-max': 'max',
  'claude-fable-5-medium': 'high',
  'claude-fable-5-low': 'medium',
  'claude-fable-5-1': 'max',
  'claude-fable-5-1-high': 'max',
  'claude-fable-5-1-xhigh': 'max',
  'claude-fable-5-1-max': 'max',
  'claude-fable-5-1-medium': 'high',
  'claude-fable-5-1-low': 'medium',
  'claude-opus-5': 'high',
  'claude-opus-5-high': 'xhigh',
  'claude-opus-5-xhigh': 'xhigh',
  'claude-opus-5-max': 'max',
  'claude-opus-5-medium': 'high',
  'claude-opus-5-low': 'medium',
  'claude-opus-4-8': 'high',
  'claude-opus-4-8-xhigh': 'xhigh',
  'claude-opus-4-8-max': 'max',
  'claude-opus-4-8-medium': 'high',
  'claude-opus-4-8-low': 'medium',
  'claude-sonnet-5': 'high',
  'claude-sonnet-5-xhigh': 'max',
  'claude-sonnet-5-medium': 'high',
  'claude-sonnet-5-low': 'medium',
  'claude-sonnet-4-6': 'high',
  'claude-opus-5-5': 'high',
  'claude-opus-5-5-high': 'xhigh',
  'claude-opus-5-5-xhigh': 'max',
  'claude-opus-5-5-max': 'max',
  'claude-opus-5-5-medium': 'high',
  'claude-opus-5-5-low': 'medium',
  'claude-sonnet-5-5': 'high',
  'claude-sonnet-5-5-high': 'xhigh',
  'claude-sonnet-5-5-xhigh': 'max',
  'claude-sonnet-5-5-max': 'max',
  'claude-sonnet-5-5-medium': 'high',
  'claude-sonnet-5-5-low': 'medium',
};

/**
 * Integrator-configurable muse position (BR75-Q2). Default `after-claude`.
 * `claude-last` orders codex, muse, cloud, then faithful claude (S6).
 */
export type MusePosition = 'off' | 'after-claude' | 'first' | 'claude-last';

export const DEFAULT_MUSE_POSITION: MusePosition = 'after-claude';

/**
 * GLM 5.3 supplemental fallback effort per launch alias (owner decisions
 * 2026-10-07 and 2026-10-08, Artificial Analysis Intelligence Index:
 * GLM-5.3 (Max) = 45 = Claude Opus 5 (Medium)). The Claude 5.5 and Fable 5.1
 * families mirror the requested effort at +1 rung on the native low/high/max
 * ladder (base/low/medium -> high; high/xhigh/max -> max); the Opus 5 and
 * Opus 4.8 families keep the measured GLM-5.3 (Max) configuration.
 * Aliases absent from this map get no GLM candidate. The candidate is the
 * LAST fallback, after Codex and Cloud Code (mistral-vibe transport).
 */
export const GLM_ROUTE_EFFORT: Readonly<Record<string, string>> = {
  'claude-opus-5': 'max',
  'claude-opus-5-high': 'max',
  'claude-opus-5-xhigh': 'max',
  'claude-opus-5-max': 'max',
  'claude-opus-4-8': 'max',
  'claude-opus-4-8-xhigh': 'max',
  'claude-opus-4-8-max': 'max',
  // Claude 5.5 and Fable 5.1 families (owner decision 2026-10-08): GLM 5.3
  // mirrors the requested effort at +1 rung on its native low/high/max
  // ladder (base/low/medium -> high; high/xhigh/max -> max).
  'claude-opus-5-5': 'high',
  'claude-opus-5-5-low': 'high',
  'claude-opus-5-5-medium': 'high',
  'claude-opus-5-5-high': 'max',
  'claude-opus-5-5-xhigh': 'max',
  'claude-opus-5-5-max': 'max',
  'claude-sonnet-5-5': 'high',
  'claude-sonnet-5-5-low': 'high',
  'claude-sonnet-5-5-medium': 'high',
  'claude-sonnet-5-5-high': 'max',
  'claude-sonnet-5-5-xhigh': 'max',
  'claude-sonnet-5-5-max': 'max',
  'claude-fable-5-1': 'high',
  'claude-fable-5-1-low': 'high',
  'claude-fable-5-1-medium': 'high',
  'claude-fable-5-1-high': 'max',
  'claude-fable-5-1-xhigh': 'max',
  'claude-fable-5-1-max': 'max',
};

export const GLM_FALLBACK_MODEL = 'zai-glm-5-3';

// Codex slot policy (BR-C55): GPT-6 Astra serves only claude-opus-5-5-max
// and the claude-fable-5-1 family; every other row serves GPT-6.1 Sol at
// +1 effort rung. Fable 5.1 keeps Astra with inherited effort.
// Cloud slot policy (owner request 2026-10-15, Artificial Analysis
// Intelligence Index read 2026-10-15, see the MUSE_ROUTE_MODEL note): Gemini 4
// Argon at high effort serves the Opus 5.5 (base/medium/high/xhigh/max),
// Sonnet 5.5 (high/xhigh/max) and Fable 5.1 rows; Opus 5.5 low and
// Sonnet 5.5 medium keep Gemini 3.8 Flash high, Sonnet 5.5 low keeps
// 3.8 Flash medium; every other row keeps 3.8 Flash high.
export const STANDARD_ROUTE_DEFINITIONS: readonly StandardRouteDefinition[] = [
  { requestedId: 'claude-opus-5', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-high', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'high', codexEffort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-xhigh', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-max', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'max', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-medium', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'medium', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-low', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'low', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8-xhigh', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8-max', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'max', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8-medium', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'medium', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8-low', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'low', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-xhigh', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-medium', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'medium', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-low', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'low', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-4-6', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-high', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'high', codexEffort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-xhigh', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-max', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'max', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-medium', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'medium', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-low', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'low', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1', codexModel: 'gpt-6-astra', cloudModel: 'gemini-4-argon', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-high', codexModel: 'gpt-6-astra', cloudModel: 'gemini-4-argon', effort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-xhigh', codexModel: 'gpt-6-astra', cloudModel: 'gemini-4-argon', effort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-max', codexModel: 'gpt-6-astra', cloudModel: 'gemini-4-argon', effort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-medium', codexModel: 'gpt-6-astra', cloudModel: 'gemini-4-argon', effort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-low', codexModel: 'gpt-6-astra', cloudModel: 'gemini-4-argon', effort: 'low', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-5', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-4-argon', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-5-high', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-4-argon', effort: 'high', codexEffort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-5-xhigh', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-4-argon', effort: 'xhigh', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-5-max', codexModel: 'gpt-6-astra', cloudModel: 'gemini-4-argon', effort: 'max', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-5-medium', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-4-argon', effort: 'medium', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-5-low', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'low', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-5', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-5-high', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-4-argon', effort: 'high', codexEffort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-5-xhigh', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-4-argon', effort: 'xhigh', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-5-max', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-4-argon', effort: 'max', codexEffort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-5-medium', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'medium', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-5-low', codexModel: 'gpt-6.1-sol', cloudModel: 'gemini-3.8-flash', effort: 'low', codexEffort: 'medium', cloudEffort: 'medium' },
];

const ANTHROPIC_FAITHFUL_TRANSPORT_PROVIDERS: readonly string[] = ['claude-code'];

const CLAUDE_SUCCESSION_MAP: Readonly<Record<string, string>> = {
  // RATIFICATION PENDING (owner decision not yet traced; see PR body):
  // model succession from api/src/services/model-selection-legacy.ts:
  // claude-sonnet-4-6 -> claude-sonnet-5
  'claude-sonnet-4-6': 'claude-sonnet-5',
};

const isFaithfulAnthropicTransport = (transportProviderId: string | undefined): boolean => (
  transportProviderId
    ? ANTHROPIC_FAITHFUL_TRANSPORT_PROVIDERS.includes(transportProviderId)
    : false
);

const codexTarget = (model: string, effort?: string): TargetMapping => ({
  providerId: 'openai', transportProviderId: 'codex', model,
  ...(effort ? { effort } : {}),
});

const claudeTarget = (model: string, effort?: string): TargetMapping => ({
  providerId: 'anthropic', transportProviderId: 'claude-code', model,
  ...(effort ? { effort } : {}),
});

const faithfulClaudeModel = (requestedId: string): string =>
  requestedId.replace(/-(?:high|xhigh|max|medium|low)$/, '');

const CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL: Readonly<
  Record<string, readonly [string, string]>
> = {
  'claude-opus-4-6-thinking': ['anthropic', 'claude-opus-4-8'],
  'gemini-3.6-flash': ['gemini', 'gemini-3.7-flash'],
  'gemini-3.1-pro': ['gemini', 'gemini-3.7-flash'],
};

export const resolveTargetCapabilitySource = (target: TargetMapping): TargetMapping => {
  const source = target.transportProviderId === 'cloud-code'
    ? CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL[target.model] : undefined;
  return source ? { ...target, providerId: source[0], model: source[1] } : target;
};

const hasModelProfile = (target: Pick<TargetMapping, 'providerId' | 'model'>): boolean =>
  modelProfiles.some(
    (profile) =>
      profile.providerId === target.providerId && profile.modelId === target.model,
  );

const hasFaithfulAnthropicProfile = (target: {
  readonly providerId: string;
  readonly transportProviderId?: string;
  readonly model: string;
}): boolean =>
  target.providerId === 'anthropic'
  && isFaithfulAnthropicTransport(target.transportProviderId)
  && hasModelProfile(target);

const resolveFaithfulAnthropicTarget = (
  requestedId: string,
  effort?: string,
): TargetMapping | undefined => {
  let faithfulModel = faithfulClaudeModel(requestedId);
  const seen = new Set<string>();

  while (!seen.has(faithfulModel)) {
    seen.add(faithfulModel);
    const candidate = claudeTarget(faithfulModel, effort);
    if (hasFaithfulAnthropicProfile(candidate)) return candidate;
    const successor = CLAUDE_SUCCESSION_MAP[faithfulModel];
    if (!successor) break;
    faithfulModel = successor;
  }
  return undefined;
};

const firstTargetThatResolvesProfile = (
  targets: readonly TargetMapping[],
): TargetMapping =>
  targets.find((target) => hasModelProfile(target)) ?? targets[0]!;

const museTarget = (requestedId: string): TargetMapping | undefined => {
  const effort = MUSE_ROUTE_EFFORT[requestedId];
  if (!effort) return undefined;
  const model = MUSE_ROUTE_MODEL[requestedId] ?? MUSE_CONTRIBUTOR_MODEL;
  const candidate: TargetMapping = {
    providerId: 'muse', transportProviderId: 'muse', model, effort,
  };
  return hasModelProfile(candidate) ? candidate : undefined;
};

const glmTarget = (requestedId: string): TargetMapping | undefined => {
  const effort = GLM_ROUTE_EFFORT[requestedId];
  if (!effort) return undefined;
  const candidate: TargetMapping = {
    providerId: 'mistral', transportProviderId: 'mistral-vibe', model: GLM_FALLBACK_MODEL, effort,
  };
  return hasModelProfile(candidate) ? candidate : undefined;
};

/**
 * A launch alias is an explicit user-facing routing contract, not benchmark
 * equivalence evidence. A known Claude id must reach its Anthropic target
 * before the permitted Muse, Codex and Cloud Code fallbacks.
 */
const launchAliasTargetsFor = (
  definition: StandardRouteDefinition,
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): readonly TargetMapping[] => {
  const { requestedId, codexModel, cloudModel, effort } = definition;
  const faithfulTarget = resolveFaithfulAnthropicTarget(requestedId, effort);
  const codexCandidate = codexTarget(
    codexModel, definition.codexEffort ?? effort,
  );
  const cloudEffort = definition.cloudEffort ?? effort;
  const cloudCandidate: TargetMapping = {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: cloudModel,
    ...(cloudEffort ? { effort: cloudEffort } : {}),
  };
  const museCandidate = musePosition === 'off' ? undefined : museTarget(requestedId);
  // GLM 5.3 supplemental fallback: always LAST in the candidate chain, after
  // Codex and Cloud Code, in every musePosition ordering.
  const glmCandidate = glmTarget(requestedId);

  if (musePosition === 'first' && museCandidate) {
    return [
      museCandidate,
      ...(faithfulTarget ? [faithfulTarget] : []),
      codexCandidate,
      cloudCandidate,
      ...(glmCandidate ? [glmCandidate] : []),
    ];
  }
  if (musePosition === 'claude-last') {
    return [
      codexCandidate,
      ...(museCandidate ? [museCandidate] : []),
      cloudCandidate,
      ...(faithfulTarget ? [faithfulTarget] : []),
      ...(glmCandidate ? [glmCandidate] : []),
    ];
  }
  return [
    ...(faithfulTarget ? [faithfulTarget] : []),
    ...(museCandidate ? [museCandidate] : []),
    codexCandidate,
    cloudCandidate,
    ...(glmCandidate ? [glmCandidate] : []),
  ];
};

const buildLaunchAliasRouteMappings = (
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): Readonly<Record<string, readonly TargetMapping[]>> => Object.fromEntries(
  STANDARD_ROUTE_DEFINITIONS.map((definition) => [
    definition.requestedId,
    launchAliasTargetsFor(definition, musePosition),
  ]),
);

export const LAUNCH_ALIAS_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = buildLaunchAliasRouteMappings();

const launchAliasRouteMappingsByPosition = new Map<MusePosition, Readonly<
  Record<string, readonly TargetMapping[]>
>>([[DEFAULT_MUSE_POSITION, LAUNCH_ALIAS_ROUTE_MAPPINGS]]);

const launchAliasRouteMappingsFor = (
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): Readonly<Record<string, readonly TargetMapping[]>> => {
  const cached = launchAliasRouteMappingsByPosition.get(musePosition);
  if (cached) return cached;
  const built = buildLaunchAliasRouteMappings(musePosition);
  launchAliasRouteMappingsByPosition.set(musePosition, built);
  return built;
};

export const CANONICAL_TARGET_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = {
  ...Object.fromEntries(Object.entries(DEFAULT_TARGET_MAPPINGS).map(
    ([requestedId, target]) => [requestedId, [target]],
  )),
  ...Object.fromEntries(Object.entries(LAUNCH_ALIAS_ROUTE_MAPPINGS).map(
    ([requestedId, targets]) => [requestedId, targets],
  )),
};

export const LAUNCH_ALIAS_TARGET_MAPPINGS = Object.fromEntries(
  Object.entries(LAUNCH_ALIAS_ROUTE_MAPPINGS)
    .map(([requestedId, targets]) => [requestedId, firstTargetThatResolvesProfile(targets)]),
);

export const CANONICAL_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> =
  Object.fromEntries(Object.entries(CANONICAL_TARGET_ROUTE_MAPPINGS)
    .map(([requestedId, targets]) => [requestedId, firstTargetThatResolvesProfile(targets)]),
  );

export const createStaticTargetResolver = (options: {
  readonly mappings: Readonly<Record<string, TargetMapping>>;
}): ModelTargetResolver => (model) => options.mappings[model];

export interface CanonicalTargetResolverOptions {
  /** Explicit library opt-in; gateway sessions additionally require a frozen mapping. */
  readonly allowEquivalentModels?: boolean;
  readonly musePosition?: MusePosition;
}

const canonicalTargetMappingsFor = (
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): Readonly<Record<string, TargetMapping>> => {
  if (musePosition === DEFAULT_MUSE_POSITION) return CANONICAL_TARGET_MAPPINGS;
  // Static defaults (including the Vibe wire alias) stay eligible under every
  // muse position; only launch-alias candidate order varies by position.
  return {
    ...Object.fromEntries(Object.entries(DEFAULT_TARGET_MAPPINGS).map(
      ([requestedId, target]) => [requestedId, firstTargetThatResolvesProfile([target])],
    )),
    ...Object.fromEntries(
      Object.entries(launchAliasRouteMappingsFor(musePosition))
        .map(([requestedId, targets]) => [
          requestedId,
          firstTargetThatResolvesProfile(targets),
        ]),
    ),
  };
};

export const createCanonicalTargetResolver = (
  options: CanonicalTargetResolverOptions = {},
): ModelTargetResolver => {
  if (options.allowEquivalentModels === true) return createStaticTargetResolver({
    mappings: canonicalTargetMappingsFor(options.musePosition ?? DEFAULT_MUSE_POSITION),
  });
  const candidates = createCanonicalTargetCandidatesResolver(options);
  return (model) => candidates(model)[0];
};

/** Identity-only aliases preserve provider/model; effort suffixes are controls. */
export const normalizeExactModelId = (model: string): string => {
  if (model === VIBE_CLI_WIRE_MODEL) return 'mistral-medium-3.5';
  if (modelProfiles.some((profile) => profile.modelId === model)) return model;
  const base = model.replace(/-(?:low|medium|high|xhigh|max)$/, '');
  return modelProfiles.some((profile) => profile.modelId === base)
    || STANDARD_ROUTE_DEFINITIONS.some((definition) => definition.requestedId === base) ? base : model;
};
export const isExactModelTarget = (requested: string, target: Pick<TargetMapping, 'providerId' | 'model'>): boolean => {
  const model = normalizeExactModelId(requested);
  const provider = modelProfiles.find((profile) => profile.modelId === model)?.providerId
    ?? (model.startsWith('claude-') ? 'anthropic' : undefined);
  return target.model === model && (!provider || target.providerId === provider);
};

export const createCanonicalTargetCandidatesResolver = (
  options: CanonicalTargetResolverOptions = {},
): ModelTargetCandidatesResolver => {
  const routeMappings = launchAliasRouteMappingsFor(
    options.musePosition ?? DEFAULT_MUSE_POSITION,
  );
  const merged: Readonly<Record<string, readonly TargetMapping[]>> = {
    ...Object.fromEntries(Object.entries(DEFAULT_TARGET_MAPPINGS).map(
      ([requestedId, target]) => [requestedId, [target]],
    )),
    ...Object.fromEntries(Object.entries(routeMappings).map(
      ([requestedId, targets]) => [requestedId, targets],
    )),
  };
  return (model) => {
    const targets = merged[model] ?? [];
    return options.allowEquivalentModels === true ? targets : targets.filter((target) => isExactModelTarget(model, target));
  };
};

export const describeTargetRoutes = (
  mappings: Readonly<Record<string, TargetMapping>>,
): readonly TargetRouteDescription[] => Object.entries(mappings)
  .map(([requestedId, target]) => ({
    requestedId,
    ...target,
    kind: requestedId === target.model ? 'faithful' as const : 'alias' as const,
  }))
  .sort((left, right) => left.requestedId.localeCompare(right.requestedId));

export const describeCanonicalTargetRoutes = (): readonly TargetRouteDescription[] =>
  Object.entries(CANONICAL_TARGET_ROUTE_MAPPINGS)
    .flatMap(([requestedId, targets]) => targets.map((target) => ({
      requestedId,
      ...target,
      kind: requestedId === target.model ? 'faithful' as const : 'alias' as const,
    })))
    .sort((left, right) => left.requestedId.localeCompare(right.requestedId)
    );
