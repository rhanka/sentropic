/**
 * context-adapter.ts — Sentropic implementation of ContextHost.
 *
 * Provides the app-specific wiring for the @sentropic/chat-ui/context module:
 * - detectContext: route → (type, id) using sentropic route map
 * - resolveContextLabel: store lookup then REST fallback
 * - iconFor: map sentropic context type → Lucide icon component
 * - loadPrefs/savePrefs: localStorage with legacy migration
 *
 * Replaces ui/src/lib/chat/context-provider.ts (deleted in Lot 3).
 *
 * LEGACY MIGRATION (data-loss prevention):
 *   Old stored entries used:
 *     - contextType/contextId field names (instead of type/id)
 *     - lastUsedAt as epoch-ms number (instead of ISO-8601 string)
 *     - "usecase" type (instead of "initiative")
 *   loadPrefs normalizes all three before returning to the module.
 */

import type { ContextHost } from '@sentropic/chat-ui/context';
import { apiGet } from '$lib/utils/api';

// ---------------------------------------------------------------------------
// ChatContextType — sentropic domain discriminants (app-side only)
// ---------------------------------------------------------------------------

export type ChatContextType =
  | 'organization'
  | 'folder'
  | 'initiative'
  | 'executive_summary';

// ---------------------------------------------------------------------------
// Route map — detectChatRouteContext
// ---------------------------------------------------------------------------

type RouteParams = Record<string, string | undefined>;

/**
 * Detect the sentropic primary context from the current SvelteKit route.
 * Returns { primaryContextType, primaryContextId? } or null.
 *
 * Kept app-side (D3): route strings and folder/initiative context are
 * sentropic domain concerns, not generic library concerns.
 */
export const detectChatRouteContext = (input: {
  routeId: string | null | undefined;
  params: RouteParams;
  currentFolderId: string | null | undefined;
}): { primaryContextType: ChatContextType; primaryContextId?: string } | null => {
  const routeId = input.routeId ?? '';
  const id = input.params['id'];

  if (routeId === '/initiative/[id]' && id) {
    return { primaryContextType: 'initiative', primaryContextId: id };
  }

  if (
    (routeId === '/initiative' ||
      routeId === '/dashboard' ||
      routeId === '/matrix') &&
    input.currentFolderId
  ) {
    return { primaryContextType: 'folder', primaryContextId: input.currentFolderId };
  }

  if (routeId === '/folders/[id]' && id) {
    return { primaryContextType: 'folder', primaryContextId: id };
  }

  if (routeId === '/organizations/[id]' && id) {
    return { primaryContextType: 'organization', primaryContextId: id };
  }

  if (routeId === '/organizations') {
    return { primaryContextType: 'organization' };
  }

  if (routeId === '/folders') {
    return { primaryContextType: 'folder' };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Context store lookup helpers (dependency-injected, no Svelte import)
// ---------------------------------------------------------------------------

export type ContextStoreLookup = {
  /** Look up a display label from in-memory Svelte stores (no network). */
  getLabelFromStores(type: string, id: string): string;
};

// ---------------------------------------------------------------------------
// Legacy prefs normalization
// ---------------------------------------------------------------------------

type RawPrefsEntry = Record<string, unknown>;

/**
 * Normalize a single legacy context entry to the ChatContextEntry shape.
 *
 * Handles:
 *   - contextType/contextId → type/id field rename
 *   - "usecase" → "initiative" type migration
 *   - lastUsedAt: number (epoch-ms) → ISO-8601 string
 */
export const normalizeLegacyContextEntry = (raw: RawPrefsEntry): RawPrefsEntry => {
  // Field rename: contextType→type, contextId→id
  const type = String(raw['contextType'] ?? raw['type'] ?? '');
  const id =
    raw['contextId'] != null
      ? String(raw['contextId'])
      : raw['id'] != null
        ? String(raw['id'])
        : undefined;

  // Type migration: "usecase" → "initiative"
  const normalizedType = type === 'usecase' ? 'initiative' : type;

  // lastUsedAt: number (epoch-ms) → ISO-8601 string
  let lastUsedAt: string | undefined;
  const rawLastUsed = raw['lastUsedAt'];
  if (typeof rawLastUsed === 'number' && rawLastUsed > 0) {
    lastUsedAt = new Date(rawLastUsed).toISOString();
  } else if (typeof rawLastUsed === 'string' && rawLastUsed) {
    lastUsedAt = rawLastUsed;
  }

  return {
    type: normalizedType,
    id,
    label: String(raw['label'] ?? ''),
    active: typeof raw['active'] === 'boolean' ? raw['active'] : true,
    used: typeof raw['used'] === 'boolean' ? raw['used'] : true,
    lastUsedAt,
  };
};

// ---------------------------------------------------------------------------
// ContextHost factory
// ---------------------------------------------------------------------------

/**
 * Create the sentropic ContextHost implementation.
 *
 * @param routeInput - function returning current route state (avoids Svelte import)
 * @param storeLookup - function returning label from in-memory stores
 * @param translate - i18n function for "executive summary of {name}" prefix
 */
export const createContextHost = (
  routeInput: () => {
    routeId: string | null | undefined;
    params: RouteParams;
    currentFolderId: string | null | undefined;
  },
  storeLookup: (type: string, id: string) => string,
  translate: (key: string, opts?: { values?: Record<string, unknown> }) => string,
): ContextHost => {
  return {
    detectContext({ routeId, params, folderId }) {
      const input = routeInput();
      return detectChatRouteContext({
        routeId: routeId ?? input.routeId,
        params: params ?? input.params,
        currentFolderId: folderId ?? input.currentFolderId,
      });
    },

    resolveContextLabel(type: string, id: string): string | Promise<string> {
      // 1. Try in-memory store first (synchronous)
      const fromStore = storeLookup(type, id);
      if (fromStore) return fromStore;

      // 2. Fall back to REST
      return (async () => {
        try {
          if (type === 'organization') {
            const res = await apiGet<{ name?: string }>(`/organizations/${id}`);
            return res?.name ?? '';
          }
          if (type === 'folder') {
            const res = await apiGet<{ name?: string }>(`/folders/${id}`);
            return res?.name ?? '';
          }
          if (type === 'executive_summary') {
            const res = await apiGet<{ name?: string }>(`/folders/${id}`);
            const name = res?.name;
            if (name) {
              return translate('chat.context.executiveSummaryPrefix', {
                values: { name },
              });
            }
            return '';
          }
          if (type === 'initiative') {
            const res = await apiGet<{
              data?: { name?: string };
              name?: string;
            }>(`/initiatives/${id}`);
            return res?.data?.name ?? res?.name ?? '';
          }
        } catch {
          // ignore
        }
        return '';
      })();
    },

    iconFor(type: string): unknown {
      // Returns a string discriminant; AppChatPanel maps to Lucide icons.
      return type;
    },

    loadPrefs(sessionId: string | null): unknown {
      if (typeof localStorage === 'undefined') return null;
      const key = `chat_session_prefs:${sessionId || 'new'}`;
      try {
        // Migrate from draft prefs when session is first created.
        if (sessionId && !localStorage.getItem(key)) {
          const draft = localStorage.getItem('chat_session_prefs:new');
          if (draft) localStorage.setItem(key, draft);
        }
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        // Normalize legacy context entries before returning.
        if (Array.isArray(parsed['contexts'])) {
          parsed['contexts'] = (parsed['contexts'] as RawPrefsEntry[])
            .filter((c) => !!(c['contextType'] ?? c['type']))
            .map(normalizeLegacyContextEntry);
        }

        return parsed;
      } catch {
        return null;
      }
    },

    savePrefs(sessionId: string | null, prefs: unknown): void {
      if (typeof localStorage === 'undefined') return;
      const key = `chat_session_prefs:${sessionId || 'new'}`;
      try {
        localStorage.setItem(key, JSON.stringify(prefs));
      } catch {
        // ignore
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Backward-compatible label-from-stores helper (used by AppChatPanel)
// ---------------------------------------------------------------------------

/**
 * Build a storeLookup function that reads from the Svelte stores.
 * Pass the current reactive store values (via $-subscriptions in AppChatPanel).
 */
export const buildStoreLookup = (
  organizations: { id: string; name?: string }[],
  folders: { id: string; name?: string }[],
  initiatives: { id: string; name?: string; data?: { name?: string } }[],
  translate: (key: string, opts?: { values?: Record<string, unknown> }) => string,
): ((type: string, id: string) => string) => {
  return (type: string, id: string): string => {
    if (!id) return '';
    if (type === 'organization') {
      const org = organizations.find((o) => o.id === id);
      return org?.name ?? '';
    }
    if (type === 'folder') {
      const folder = folders.find((f) => f.id === id);
      return folder?.name ?? '';
    }
    if (type === 'initiative') {
      const initiative = initiatives.find((u) => u.id === id);
      return initiative?.data?.name ?? initiative?.name ?? '';
    }
    if (type === 'executive_summary') {
      const folder = folders.find((f) => f.id === id);
      return folder?.name
        ? translate('chat.context.executiveSummaryPrefix', { values: { name: folder.name } })
        : '';
    }
    return '';
  };
};

// ---------------------------------------------------------------------------
// iconFor mapping (used in AppChatPanel template)
// ---------------------------------------------------------------------------

/**
 * Returns a string discriminant for context type → icon mapping.
 * AppChatPanel maps these to Lucide icon components.
 *
 * Type is string (open) so the adapter stays generic.
 * AppChatPanel uses a switch/record to map to actual icon components.
 */
export const contextTypeIconKey = (type: string): ChatContextType | 'file' => {
  if (
    type === 'organization' ||
    type === 'folder' ||
    type === 'initiative' ||
    type === 'executive_summary'
  ) {
    return type as ChatContextType;
  }
  return 'file';
};
