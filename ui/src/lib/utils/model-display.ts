import { getModelLabel } from '$lib/stores/modelCatalog';

export const formatCompactModelLabel = (
  model: string | null | undefined,
): string => {
  const raw = typeof model === 'string' ? model.trim() : '';
  if (!raw) return '';

  return getModelLabel(raw);
};
