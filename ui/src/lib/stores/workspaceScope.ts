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

// Used to prevent "read-only banner" flicker on first app load before roles are fetched.
export const workspaceScopeHydrated = writable(false);

export function setWorkspaceScope(id: string | null) {
  const next = (id || '').trim();
  const current = get(workspaceScope).selectedId ?? null;
  const nextId = next || null;
  if (current === nextId) return;
  workspaceScope.update((s) => ({ ...s, selectedId: nextId }));
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

// When the user is no longer a member of any workspace, redirect to /parametres.
export const noWorkspaceLock = derived([session, workspaceScope], ([$session, $scope]) => {
  if (!$session.user) return false;
  if ($scope.loading) return false;
  return ($scope.items || []).length === 0;
});

// When a hidden workspace is selected, only /parametres should be accessible until the workspace is made visible again.
export const hiddenWorkspaceLock = derived([session, selectedWorkspace], ([$session, ws]) => {
  if (!$session.user) return false;
  if (!ws) return false;
  return ws.role === 'admin' && Boolean(ws.hiddenAt);
});

// Read-only scope for regular users: viewer role (or no resolved role) => disable UI mutations.
export const workspaceReadOnlyScope = derived([session, selectedWorkspaceRole], ([$session, role]) => {
  if (!$session.user) return true;
  return role !== 'editor' && role !== 'admin';
});

export function getScopedWorkspaceIdForUser(): string | null {
  const s = get(session);
  if (!s.user) return null;
  const id = get(workspaceScope).selectedId;
  return id && id.trim() ? id : null;
}

export async function loadUserWorkspaces(): Promise<void> {
  const s = get(session);
  if (!s.user) {
    workspaceScopeHydrated.set(false);
    return;
  }

  workspaceScopeHydrated.set(false);
  workspaceScope.update((st) => ({ ...st, loading: true, error: null }));
  try {
    const data = await apiGet<{ items: UserWorkspace[] }>('/workspaces');
    const rawItems = Array.isArray(data?.items) ? data.items : [];
    // Hidden workspaces are only visible to workspace admins (defensive client-side filter).
    const items = rawItems.filter((w) => !w.hiddenAt || w.role === 'admin');

    workspaceScope.update((st) => {
      const selectedIdRaw = st.selectedId || '';
      const selectedItem = selectedIdRaw ? items.find((w) => w.id === selectedIdRaw) ?? null : null;
      const nonHidden = items.filter((w) => !w.hiddenAt);
      const allHidden = items.length > 0 && nonHidden.length === 0;
      const fallbackVisible = nonHidden[0]?.id || null;
      const fallbackHidden = items[0]?.id || null;

      // Keep selection even if the workspace is hidden (admin-only), because a hidden selected workspace
      // must lock navigation to /parametres via `hiddenWorkspaceLock`.
      const selectedId =
        selectedItem && (!selectedItem.hiddenAt || selectedItem.role === 'admin')
          ? selectedItem.id
          : (allHidden ? fallbackHidden : fallbackVisible);

      if (browser) {
        if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId);
        else localStorage.removeItem(STORAGE_KEY);
      }

      return { ...st, loading: false, items, selectedId, error: null };
    });
  } catch (e: any) {
    workspaceScope.update((st) => ({ ...st, loading: false, error: e?.message ?? 'Erreur chargement workspaces' }));
  } finally {
    workspaceScopeHydrated.set(true);
  }
}

if (browser) {
  const handleMembershipUpdate = (evt: Event) => {
    const detail = (evt as CustomEvent<any>).detail as {
      userId?: string;
    } | null;
    const currentUserId = get(session)?.user?.id;
    if (!currentUserId) return;
    if (detail?.userId && detail.userId !== currentUserId) return;
    void loadUserWorkspaces();
  };

  window.addEventListener('streamhub:workspace_membership_update', handleMembershipUpdate);
  window.addEventListener('streamhub:workspace_update', handleMembershipUpdate);
}


