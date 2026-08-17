import type { ProviderId } from './provider-runtime';

export type LegacyModelCutoverRule = {
  providerId: ProviderId;
  fromModelId: string;
  toModelId: string;
};

const LEGACY_MODEL_CUTOVER_RULES: LegacyModelCutoverRule[] = [
  {
    // Owner decision (WP16): the OpenAI default migrates to GPT-5.6 Luna.
    // gpt-5.2 (legacy) and gpt-5.5 both cut over to Luna for default resolution;
    // gpt-5.5 remains explicitly selectable in the catalog.
    providerId: 'openai',
    fromModelId: 'gpt-5.2',
    toModelId: 'gpt-5.6-luna',
  },
  {
    providerId: 'openai',
    fromModelId: 'gpt-5.5',
    toModelId: 'gpt-5.6-luna',
  },
  {
    providerId: 'gemini',
    fromModelId: 'gemini-2.5-flash-lite',
    toModelId: 'gemini-3.1-flash-lite',
  },
  {
    // Retired by Google ("no longer available"); succeeded by the GA id below.
    providerId: 'gemini',
    fromModelId: 'gemini-3.1-flash-lite-preview',
    toModelId: 'gemini-3.1-flash-lite',
  },
  {
    // Non-existent id merged by error; migrate any saved selection to the real lite model.
    providerId: 'gemini',
    fromModelId: 'gemini-3.5-thinking',
    toModelId: 'gemini-3.1-flash-lite',
  },
  {
    providerId: 'gemini',
    fromModelId: 'gemini-3.1-pro-preview-customtools',
    toModelId: 'gemini-3.5-flash',
  },
  {
    // RATIFICATION PENDING (owner decision not yet traced; see PR body):
    // this legacy Anthropic succession was introduced with eb9a0edac without a traceable
    // owner ratification reference in this file.
    providerId: 'anthropic',
    fromModelId: 'claude-sonnet-4-6',
    toModelId: 'claude-sonnet-5',
  },
  {
    providerId: 'anthropic',
    fromModelId: 'claude-opus-4-7',
    toModelId: 'claude-opus-4-8',
  },
];

const LEGACY_MODEL_CUTOVER_BY_MODEL = new Map(
  LEGACY_MODEL_CUTOVER_RULES.map((rule) => [rule.fromModelId, rule]),
);

const normalizeModelId = (value: string | null | undefined): string => {
  return String(value ?? '').trim().toLowerCase();
};

export const findLegacyModelCutoverRule = (
  modelId: string | null | undefined,
): LegacyModelCutoverRule | null => {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) return null;
  return LEGACY_MODEL_CUTOVER_BY_MODEL.get(normalizedModelId) ?? null;
};

export const normalizeLegacyModelSelection = (input: {
  providerId?: string | null;
  modelId?: string | null;
}): {
  providerId: string | null;
  modelId: string | null;
  migrated: boolean;
} => {
  const normalizedProviderId = String(input.providerId ?? '').trim() || null;
  const normalizedModelId = String(input.modelId ?? '').trim() || null;
  const rule = findLegacyModelCutoverRule(normalizedModelId);

  if (!rule) {
    return {
      providerId: normalizedProviderId,
      modelId: normalizedModelId,
      migrated: false,
    };
  }

  return {
    providerId: rule.providerId,
    modelId: rule.toModelId,
    migrated: true,
  };
};
