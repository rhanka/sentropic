import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createKeyedReload, folderScopeKey } from '../../src/lib/utils/keyed-reload';
import { initiativesStore } from '../../src/lib/stores/initiatives';
import { currentFolderId } from '../../src/lib/stores/folders';
import { workspaceScope } from '../../src/lib/stores/workspaceScope';

// Mirrors the folder page: load once per key, re-apply currentFolderId, and let
// the root layout reset (+layout.svelte) wipe the stores on scope change.
const FOLDER = 'f1';
const useCase = { id: 'uc1', folderId: FOLDER } as never;

const layoutReset = () => {
  currentFolderId.set(null);
  initiativesStore.set([]);
};

describe('folder page keyed reload', () => {
  it('reloads the list when the scope changes after the list response landed', async () => {
    initiativesStore.set([]);
    const reload = createKeyedReload();
    let loads = 0;
    const load = async () => {
      const token = reload.begin(folderScopeKey(FOLDER, get(workspaceScope).selectedId));
      loads += 1;
      const list = [useCase];
      if (reload.isCurrent(token)) initiativesStore.set(list);
    };
    const onScopeChange = () => {
      if (reload.needsReload(folderScopeKey(FOLDER, get(workspaceScope).selectedId))) {
        currentFolderId.set(FOLDER);
        void load();
      }
    };

    workspaceScope.update((s) => ({ ...s, selectedId: 'ws-stored' }));
    currentFolderId.set(FOLDER);
    await load(); // list response lands first
    expect(get(initiativesStore)).toHaveLength(1);

    // Late /workspaces re-scope: layout resets, scope id changes.
    layoutReset();
    workspaceScope.update((s) => ({ ...s, selectedId: 'ws-confirmed' }));
    onScopeChange();
    await Promise.resolve();

    expect(loads).toBe(2);
    expect(get(initiativesStore)).toHaveLength(1);
    expect(get(currentFolderId)).toBe(FOLDER);

    onScopeChange(); // unchanged key: no extra load
    expect(loads).toBe(2);
  });

  it('drops the response of a superseded load', () => {
    const reload = createKeyedReload();
    const first = reload.begin(folderScopeKey(FOLDER, 'a'));
    const second = reload.begin(folderScopeKey(FOLDER, 'b'));
    expect(reload.isCurrent(first)).toBe(false);
    expect(reload.isCurrent(second)).toBe(true);
    expect(reload.needsReload(folderScopeKey(FOLDER, 'b'))).toBe(false);
    expect(reload.needsReload(folderScopeKey('f2', 'b'))).toBe(true);
  });
});
