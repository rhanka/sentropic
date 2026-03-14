import { writable, derived, get } from 'svelte/store';
import { apiGet } from '$lib/utils/api';

type CatalogModel = {
  provider_id: string;
  model_id: string;
  label: string;
  default_contexts: string[];
};

type CatalogPayload = {
  providers: unknown[];
  models: CatalogModel[];
  defaults: { provider_id: string; model_id: string };
};

const models = writable<CatalogModel[]>([]);
let loaded = false;

export const loadModelCatalog = async () => {
  if (loaded) return;
  try {
    const payload = await apiGet<CatalogPayload>('/models/catalog');
    models.set(Array.isArray(payload.models) ? payload.models : []);
    loaded = true;
  } catch {
    // silent — badges will fall back to raw modelId
  }
};

export const modelLabelMap = derived(models, ($models) => {
  const map = new Map<string, string>();
  for (const m of $models) {
    map.set(m.model_id, m.label);
  }
  return map;
});

export const getModelLabel = (modelId: string | null | undefined): string => {
  if (!modelId) return '';
  return get(modelLabelMap).get(modelId) ?? modelId;
};
