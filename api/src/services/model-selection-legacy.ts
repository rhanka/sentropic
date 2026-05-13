import type { ProviderId } from './provider-runtime';

export type LegacyModelCutoverRule = {
  providerId: ProviderId;
  fromModelId: string;
  toModelId: string;
};

const LEGACY_MODEL_CUTOVER_RULES: LegacyModelCutoverRule[] = [
  {
    providerId: 'openai',
    fromModelId: 'gpt-5.2',
    toModelId: 'gpt-5.5',
  },
  {
    providerId: 'gemini',
    fromModelId: 'gemini-2.5-flash-lite',
    toModelId: 'gemini-3.1-flash-lite-preview',
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
