import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resetFetchMock, mockFetchJsonOnce } from '../test-setup';
import { session, setUser, clearUser } from '../../src/lib/stores/session';
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

  it('ignores a membership refresh started before the imported workspace became visible', async () => {
    setUser(user);
    setWorkspaceScope('ws-old');
    let finishOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
    const oldRefresh = loadUserWorkspaces();
    const oldWorkspace = { id: 'ws-old', name: 'Old', role: 'admin', hiddenAt: null };
    const importedWorkspace = { ...oldWorkspace, id: 'ws-imported', name: 'Imported' };
    mockFetchJsonOnce({ items: [oldWorkspace, importedWorkspace] });
    await loadUserWorkspaces();
    setWorkspaceScope('ws-imported');
    finishOld(new Response(JSON.stringify({ items: [oldWorkspace] }), { status: 200 }));
    await oldRefresh;
    expect(get(workspaceScope).selectedId).toBe('ws-imported');
    expect(localStorage.getItem('workspaceScopeId')).toBe('ws-imported');
    expect(get(workspaceScope).items.map(item => item.id)).toContain('ws-imported');
  });

  it.each([409, 500])('ignores a stale refresh error %s after a newer membership list', async (status) => {
    setUser(user);
    let finishOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
    const oldRefresh = loadUserWorkspaces();
    mockFetchJsonOnce({ items: [{ id: 'ws-imported', name: 'Imported', role: 'admin', hiddenAt: null }] });
    await loadUserWorkspaces();
    finishOld(new Response(JSON.stringify({ message: 'stale failure' }), { status }));
    await oldRefresh;
    expect(get(workspaceScope).selectedId).toBe('ws-imported');
    expect(get(workspaceScope).error).toBeNull();
    expect(get(workspaceScopeHydrated)).toBe(true);
  });

  it.each(['user-b', null])('abandons the actual import continuation after session changes to %s', async (nextUser) => {
    setUser(user);
    const source = readFileSync('src/lib/components/ImportExportDialog.svelte', 'utf8');
    const handler = source.slice(source.indexOf('  const handleImport ='), source.indexOf('  const handleFileChange ='));
    let finishRefresh!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finishRefresh = resolve; }));
    const folder = writable<string | null>('folder-a');
    const dispatch = vi.fn();
    const deps = { get, session, selectedFile: 'zip', importPreview: null, buildSelectedTypes: () => ['folder'],
      isNewWorkspace: () => true, targetWorkspaceId: '__new__', importTargetType: null, importTargetId: null,
      importIncludeComments: true, importIncludeDocuments: true, buildScopedUrl: () => '/imports',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ workspace_id: 'ws-a', target_folder_id: 'folder-imported' }))),
      addToast: vi.fn(), $_: () => '', loadUserWorkspaces: refresh, setWorkspaceScope, currentFolderId: folder,
      dispatch, close: vi.fn() };
    const script = `const {${Object.keys(deps).join(',')}} = deps; let isBusy = false; ${handler}; return handleImport;`;
    const run = new Function('deps', ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(deps);
    const attempt = run();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    if (nextUser) setUser({ ...user, id: nextUser });
    else clearUser();
    const expectedWorkspace = nextUser ? 'ws-b' : null;
    const expectedFolder = nextUser ? 'folder-b' : null;
    setWorkspaceScope(expectedWorkspace);
    folder.set(expectedFolder);
    finishRefresh();
    await attempt;
    expect(get(workspaceScope).selectedId).toBe(expectedWorkspace);
    expect(localStorage.getItem('workspaceScopeId')).toBe(expectedWorkspace);
    expect(get(folder)).toBe(expectedFolder);
    expect(dispatch).not.toHaveBeenCalled();
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

  it('returns null when user is present but workspace is not selected', () => {
    setUser(user);
    setWorkspaceScope(null);

    expect(getScopedWorkspaceIdForUser()).toBeNull();
  });

  it('returns null when no user is set', () => {
    setWorkspaceScope('ws-123');

    expect(getScopedWorkspaceIdForUser()).toBeNull();
  });

  it('returns null when selected workspace is blank', () => {
    setUser(user);
    setWorkspaceScope('   ');

    expect(getScopedWorkspaceIdForUser()).toBeNull();
  });
});
