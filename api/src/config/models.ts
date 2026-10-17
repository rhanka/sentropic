/** Reversible branch default; the owner selects A or B after qualification. */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export const LUNA_MAX_INPUT_TOKENS = 922_000;
export const LUNA_MAX_OUTPUT_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = LUNA_MAX_OUTPUT_TOKENS;
export const LUNA_CONTEXT_WINDOW = 1_050_000;
export const RETIRED_NANO_MODEL_IDS = ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14'] as const;

/** Existing deployments may still explicitly configure a retired alias. */
export const getDefaultOpenAIModel = (value = process.env.OPENAI_MODEL): string => {
  const model = value?.trim() || '';
  return !model || RETIRED_NANO_MODEL_IDS.some((retired) => retired === model.toLowerCase())
    ? DEFAULT_OPENAI_MODEL
    : model;
};
