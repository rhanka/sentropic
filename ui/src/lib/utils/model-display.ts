const GEMINI_SHORT_ID_PATTERN = /^gemini-(\d+(?:\.\d+)?)/i;

export const formatCompactModelLabel = (
  model: string | null | undefined,
): string => {
  const raw = typeof model === 'string' ? model.trim() : '';
  if (!raw) return '';

  const geminiMatch = raw.match(GEMINI_SHORT_ID_PATTERN);
  if (geminiMatch?.[1]) {
    return `gemini-${geminiMatch[1]}`;
  }

  return raw;
};
