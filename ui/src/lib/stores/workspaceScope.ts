import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { apiGet } from '$lib/utils/api';
import { session } from '$lib/stores/session';

const STORAGE_KEY = 'workspaceScopeId';

export type UserWorkspaceRole = 'viewer' | 'editor' | 'admin';

export type UserWorkspace = {
  id: string;
  name: string;
  role: UserWorkspaceRole;
  hiddenAt: string | null;
  createdAt: string;
};

type State = {
  loading: boolean;
  items: UserWorkspace[];
  selectedId: string | null;
  error: string | null;
};

const initialSelected = browser ? localStorage.getItem(STORAGE_KEY) : null;

export const workspaceScope = writable<State>({
  loading: false,
  items: [],
  selectedId: initialSelected,
  error: null
});

export function setWorkspaceScope(id: string) {
  const next = id || '';
  workspaceScope.update((s) => ({ ...s, selectedId: next || null }));
  if (browser) localStorage.setItem(STORAGE_KEY, next);
}

export function getScopedWorkspaceIdForUser(): string | null {
  const s = get(session);
  if (!s.user) return null;
  if (s.user.role === 'admin_app') return null;
  const id = get(workspaceScope).selectedId;
  return id && id.trim() ? id : null;
}

export async function loadUserWorkspaces(): Promise<void> {
  const s = get(session);
  if (!s.user) return;
  if (s.user.role === 'admin_app') return;

  workspaceScope.update((st) => ({ ...st, loading: true, error: null }));
  try {
    const data = await apiGet<{ items: UserWorkspace[] }>('/workspaces');
    const items = Array.isArray(data?.items) ? data.items : [];

    workspaceScope.update((st) => {
      const selectedIdRaw = st.selectedId || '';
      const selectedOk = !!selectedIdRaw && items.some((w) => w.id === selectedIdRaw);
      const nonHidden = items.filter((w) => !w.hiddenAt);
      const fallback = nonHidden[0]?.id || items[0]?.id || null;
      const selectedId = selectedOk ? selectedIdRaw : fallback;

      if (browser && selectedId) localStorage.setItem(STORAGE_KEY, selectedId);

      return { ...st, loading: false, items, selectedId, error: null };
    });
  } catch (e: any) {
    workspaceScope.update((st) => ({ ...st, loading: false, error: e?.message ?? 'Erreur chargement workspaces' }));
  }
}


