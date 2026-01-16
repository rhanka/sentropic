import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { resetFetchMock, mockFetchJsonOnce } from '../test-setup';
import { setUser, clearUser } from '../../src/lib/stores/session';
import {
  workspaceScope,
  workspaceScopeHydrated,
  setWorkspaceScope,
  loadUserWorkspaces,
  noWorkspaceLock,
  hiddenWorkspaceLock,
  workspaceReadOnlyScope,
  getScopedWorkspaceIdForUser,
} from '../../src/lib/stores/workspaceScope';
import type { User } from '../../src/lib/stores/session';

describe('workspaceScope store', () => {
  const user: User = {
    id: 'user-1',
    email: 'user@example.com',
    displayName: 'User',
    role: 'editor',
  };

  beforeEach(() => {
    resetFetchMock();
    localStorage.clear();
    clearUser();
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });
    workspaceScopeHydrated.set(false);
  });

  it('sets selected workspace from localStorage when hidden admin workspace is selected', async () => {
    setUser(user);
    setWorkspaceScope('ws-hidden');

    mockFetchJsonOnce({
      items: [
        { id: 'ws-hidden', name: 'Hidden', role: 'admin', hiddenAt: '2025-01-01', createdAt: '2025-01-01' },
        { id: 'ws-visible', name: 'Visible', role: 'editor', hiddenAt: null, createdAt: '2025-01-02' },
      ],
    });

    await loadUserWorkspaces();

    expect(get(workspaceScope).selectedId).toBe('ws-hidden');
    expect(get(workspaceScopeHydrated)).toBe(true);
    expect(get(hiddenWorkspaceLock)).toBe(true);
  });

  it('falls back to visible workspace when stored selection is hidden and not admin', async () => {
    setUser(user);
    localStorage.setItem('workspaceScopeId', 'ws-hidden');

    mockFetchJsonOnce({
      items: [
        { id: 'ws-hidden', name: 'Hidden', role: 'viewer', hiddenAt: '2025-01-01', createdAt: '2025-01-01' },
        { id: 'ws-visible', name: 'Visible', role: 'editor', hiddenAt: null, createdAt: '2025-01-02' },
      ],
    });

    await loadUserWorkspaces();

    expect(get(workspaceScope).selectedId).toBe('ws-visible');
    expect(get(hiddenWorkspaceLock)).toBe(false);
  });

  it('derives noWorkspaceLock when user has no workspaces', () => {
    setUser(user);
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });

    expect(get(noWorkspaceLock)).toBe(true);
  });

  it('derives workspaceReadOnlyScope from selected role', () => {
    setUser(user);
    workspaceScope.set({
      loading: false,
      items: [{ id: 'ws-1', name: 'WS', role: 'viewer', hiddenAt: null, createdAt: '2025-01-01' }],
      selectedId: 'ws-1',
      error: null,
    });

    expect(get(workspaceReadOnlyScope)).toBe(true);

    workspaceScope.set({
      loading: false,
      items: [{ id: 'ws-2', name: 'WS2', role: 'admin', hiddenAt: null, createdAt: '2025-01-01' }],
      selectedId: 'ws-2',
      error: null,
    });

    expect(get(workspaceReadOnlyScope)).toBe(false);
  });

  it('returns scoped workspace id when user is present', () => {
    setUser(user);
    setWorkspaceScope('ws-123');

    expect(getScopedWorkspaceIdForUser()).toBe('ws-123');
  });
});
