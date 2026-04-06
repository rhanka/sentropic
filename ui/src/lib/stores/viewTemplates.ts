/**
 * View template store — fetches and caches view templates from the API.
 * Provides a resolve function that matches the API resolution endpoint.
 */
import { writable, get } from 'svelte/store';
import { apiGet } from '$lib/utils/api';
import type { ViewTemplateRecord } from '$lib/types/view-template';

type ViewTemplateCache = Map<string, ViewTemplateRecord>;

const cache = writable<ViewTemplateCache>(new Map());
const loading = writable<Set<string>>(new Set());

function cacheKey(workspaceType: string, objectType: string, maturityStage?: string | null): string {
  return `${workspaceType}:${objectType}:${maturityStage ?? ''}`;
}

/**
 * Resolve a view template for a given resolution key.
 * Returns the cached value if available, otherwise fetches from API.
 */
export async function resolveViewTemplate(
  workspaceType: string,
  objectType: string,
  maturityStage?: string | null,
): Promise<ViewTemplateRecord | null> {
  const key = cacheKey(workspaceType, objectType, maturityStage);

  // Check cache first
  const cached = get(cache).get(key);
  if (cached) return cached;

  // Prevent duplicate fetches
  const loadingSet = get(loading);
  if (loadingSet.has(key)) return null;
  loading.update((s) => { s.add(key); return new Set(s); });

  try {
    const params = new URLSearchParams({
      workspace_type: workspaceType,
      object_type: objectType,
    });
    if (maturityStage) params.set('maturity_stage', maturityStage);

    const record = await apiGet<ViewTemplateRecord>(`/view-templates/resolve?${params}`);
    if (record) {
      cache.update((m) => {
        m.set(key, record);
        return new Map(m);
      });
      return record;
    }
  } catch {
    // Resolution failed — return null (caller should fall back to hardcoded view)
  } finally {
    loading.update((s) => { s.delete(key); return new Set(s); });
  }

  return null;
}

/**
 * List all view templates for the current workspace.
 */
export async function listViewTemplates(workspaceType?: string): Promise<ViewTemplateRecord[]> {
  try {
    const params = workspaceType ? `?workspace_type=${workspaceType}` : '';
    const data = await apiGet<{ items: ViewTemplateRecord[] }>(`/view-templates${params}`);
    return data.items ?? [];
  } catch {
    return [];
  }
}

/**
 * Clear the view template cache (e.g., on workspace switch).
 */
export function clearViewTemplateCache(): void {
  cache.set(new Map());
}
