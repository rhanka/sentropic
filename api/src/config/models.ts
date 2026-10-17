/** Reversible branch default; the owner selects A or B after qualification. */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export const RETIRED_NANO_MODEL_IDS = ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14'] as const;

/** Existing deployments may still explicitly configure a retired alias. */
export const getDefaultOpenAIModel = (value = process.env.OPENAI_MODEL): string => {
  const model = value?.trim() || '';
  return !model || RETIRED_NANO_MODEL_IDS.some((retired) => retired === model.toLowerCase())
    ? DEFAULT_OPENAI_MODEL
    : model;
};
