import { writable, get, derived } from 'svelte/store';
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

export function setWorkspaceScope(id: string | null) {
  const next = (id || '').trim();
  workspaceScope.update((s) => ({ ...s, selectedId: next || null }));
  if (!browser) return;
  if (next) localStorage.setItem(STORAGE_KEY, next);
  else localStorage.removeItem(STORAGE_KEY);
}

export const selectedWorkspace = derived(workspaceScope, ($s) => {
  return ($s.items || []).find((w) => w.id === $s.selectedId) ?? null;
});

export const selectedWorkspaceRole = derived(selectedWorkspace, ($w) => {
  return $w?.role ?? null;
});

export const selectedWorkspaceHidden = derived(selectedWorkspace, ($w) => {
  return Boolean($w?.hiddenAt);
});

// When a hidden workspace is selected, only /parametres should be accessible until the workspace is made visible again.
export const hiddenWorkspaceLock = derived([session, selectedWorkspace], ([$session, ws]) => {
  if (!$session.user) return false;
  if ($session.user.role === 'admin_app') return false;
  if (!ws) return false;
  return ws.role === 'admin' && Boolean(ws.hiddenAt);
});

// Read-only scope for regular users: viewer role (or no resolved role) => disable UI mutations.
export const workspaceReadOnlyScope = derived([session, selectedWorkspaceRole], ([$session, role]) => {
  if (!$session.user) return true;
  if ($session.user.role === 'admin_app') return false;
  return role !== 'editor' && role !== 'admin';
});

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
    const rawItems = Array.isArray(data?.items) ? data.items : [];
    // Hidden workspaces are only visible to workspace admins (defensive client-side filter).
    const items = rawItems.filter((w) => !w.hiddenAt || w.role === 'admin');

    workspaceScope.update((st) => {
      const selectedIdRaw = st.selectedId || '';
      const selectedOk =
        !!selectedIdRaw && items.some((w) => w.id === selectedIdRaw && !w.hiddenAt);
      const nonHidden = items.filter((w) => !w.hiddenAt);
      const allHidden = items.length > 0 && nonHidden.length === 0;
      const fallback = nonHidden[0]?.id || null;
      const selectedId = allHidden ? null : (selectedOk ? selectedIdRaw : fallback);

      if (browser) {
        if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId);
        else localStorage.removeItem(STORAGE_KEY);
      }

      return { ...st, loading: false, items, selectedId, error: null };
    });
  } catch (e: any) {
    workspaceScope.update((st) => ({ ...st, loading: false, error: e?.message ?? 'Erreur chargement workspaces' }));
  }
}


