import { apiGet } from '$lib/utils/api';

/**
 * Client-side cache for view-templates/resolve API calls.
 * Deduplicates in-flight requests and caches resolved descriptors
 * by key: `${workspaceId}:${workspaceType}:${objectType}`.
 */

const resolved = new Map<string, any>();
const inflight = new Map<string, Promise<any>>();

function cacheKey(workspaceId: string, workspaceType: string, objectType: string): string {
  return `${workspaceId}:${workspaceType}:${objectType}`;
}

export async function resolveViewTemplate(
  workspaceId: string,
  workspaceType: string,
  objectType: string
): Promise<any> {
  const key = cacheKey(workspaceId, workspaceType, objectType);

  if (resolved.has(key)) {
    return resolved.get(key);
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = apiGet(`/view-templates/resolve?workspaceId=${workspaceId}&workspaceType=${workspaceType}&objectType=${objectType}`)
    .then((result: any) => {
      const descriptor = result?.descriptor ?? null;
      resolved.set(key, descriptor);
      inflight.delete(key);
      return descriptor;
    })
    .catch((e: unknown) => {
      inflight.delete(key);
      console.warn('Failed to resolve view template:', e);
      return null;
    });

  inflight.set(key, promise);
  return promise;
}

/** Clear all cached entries (useful if workspace changes externally). */
export function clearViewTemplateCache(): void {
  resolved.clear();
  inflight.clear();
}
