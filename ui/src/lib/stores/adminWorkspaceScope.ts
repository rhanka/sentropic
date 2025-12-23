import { writable, get, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { API_BASE_URL } from '$lib/config';
import { session } from '$lib/stores/session';

export const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const STORAGE_KEY = 'adminWorkspaceScopeId';

export type AdminWorkspace = {
  id: string;
  name: string;
  shareWithAdmin: boolean;
  ownerUserId: string | null;
  ownerEmail?: string | null;
};

type State = {
  loading: boolean;
  items: AdminWorkspace[];
  selectedId: string;
  error: string | null;
};

const initialSelected = browser ? (localStorage.getItem(STORAGE_KEY) || ADMIN_WORKSPACE_ID) : ADMIN_WORKSPACE_ID;

export const adminWorkspaceScope = writable<State>({
  loading: false,
  items: [],
  selectedId: initialSelected,
  error: null
});

export function setAdminWorkspaceScope(id: string) {
  const next = id || ADMIN_WORKSPACE_ID;
  adminWorkspaceScope.update((s) => ({ ...s, selectedId: next }));
  if (browser) localStorage.setItem(STORAGE_KEY, next);
}

export function getScopedWorkspaceIdForAdmin(): string | null {
  const s = get(session);
  if (s.user?.role !== 'admin_app') return null;
  const scope = get(adminWorkspaceScope).selectedId;
  if (!scope || scope === ADMIN_WORKSPACE_ID) return null;
  return scope;
}

export const adminReadOnlyScope = derived([session, adminWorkspaceScope], ([$session, $scope]) => {
  return $session.user?.role === 'admin_app' && ($scope.selectedId ?? ADMIN_WORKSPACE_ID) !== ADMIN_WORKSPACE_ID;
});

export async function loadAdminWorkspaces(): Promise<void> {
  const s = get(session);
  if (s.user?.role !== 'admin_app') return;

  adminWorkspaceScope.update((st) => ({ ...st, loading: true, error: null }));
  try {
    const res = await fetch(`${API_BASE_URL}/admin/workspaces`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
    const items = Array.isArray(data?.items) ? (data.items as AdminWorkspace[]) : [];
    adminWorkspaceScope.update((st) => {
      const selectedId = st.selectedId || ADMIN_WORKSPACE_ID;
      const allowed = selectedId === ADMIN_WORKSPACE_ID || items.some((w) => w.id === selectedId);
      return {
        ...st,
        loading: false,
        items,
        selectedId: allowed ? selectedId : ADMIN_WORKSPACE_ID,
        error: null
      };
    });
  } catch (e: any) {
    adminWorkspaceScope.update((st) => ({ ...st, loading: false, error: e?.message ?? 'Erreur chargement workspaces' }));
  }
}


