const MODEL_SHORT_LABELS: Record<string, string> = {
  // OpenAI
  'gpt-5.4': 'GPT-5.4',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  // Gemini
  'gemini-3.1-pro-preview-customtools': 'Gemini 3.1 Pro',
  'gemini-3.1-flash-lite-preview': 'Flash Lite',
  // Anthropic
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  // Mistral
  'devstral-2512': 'Devstral 2',
  'magistral-medium-2509': 'Magistral 1.2',
  // Cohere
  'command-a-03-2025': 'Command A',
  'command-a-reasoning-08-2025': 'Command A R.',
};

export const formatCompactModelLabel = (
  model: string | null | undefined,
): string => {
  const raw = typeof model === 'string' ? model.trim() : '';
  if (!raw) return '';

  return MODEL_SHORT_LABELS[raw] ?? raw;
};
