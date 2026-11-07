import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createKeyedReload, folderScopeKey } from '../../src/lib/utils/keyed-reload';
import { initiativesStore } from '../../src/lib/stores/initiatives';
import { currentFolderId } from '../../src/lib/stores/folders';
import { workspaceScope } from '../../src/lib/stores/workspaceScope';

// Mirrors the matrix page: syncMatrix loads once per (folder, scope) key and
// re-applies the remembered folder id; the root layout reset (+layout.svelte)
// wipes currentFolderId and the shared stores on a late scope change.
const FOLDER = 'f1';

const layoutReset = () => {
  currentFolderId.set(null);
  initiativesStore.set([]);
};

const createPage = () => {
  const reload = createKeyedReload();
  let lastFolderId: string | null = null;
  const applied: string[] = [];
  const sync = async (fetchFolder: (id: string) => Promise<string>) => {
    const folderId = get(currentFolderId) ?? lastFolderId;
    if (!folderId) return;
    const key = folderScopeKey(folderId, get(workspaceScope).selectedId);
    if (!reload.needsReload(key)) return;
    lastFolderId = folderId;
    if (get(currentFolderId) !== folderId) currentFolderId.set(folderId);
    const token = reload.begin(key);
    const folder = await fetchFolder(folderId);
    if (!reload.isCurrent(token)) return;
    applied.push(folder);
  };
  return { sync, applied };
};

describe('matrix page keyed reload', () => {
  it('reloads after the layout reset and scope change, without a double load on a normal visit', async () => {
    workspaceScope.update((s) => ({ ...s, selectedId: 'ws-stored' }));
    currentFolderId.set(FOLDER);
    const page = createPage();
    let loads = 0;
    const fetchFolder = async (id: string) => {
      loads += 1;
      return `${id}#${loads}`;
    };

    await page.sync(fetchFolder); // mount
    await page.sync(fetchFolder); // reactive re-run, same key
    expect(loads).toBe(1);

    layoutReset(); // layout wipes the stores, scope not yet changed
    await page.sync(fetchFolder);
    expect(loads).toBe(1);

    workspaceScope.update((s) => ({ ...s, selectedId: 'ws-confirmed' }));
    await page.sync(fetchFolder);
    expect(loads).toBe(2);
    expect(get(currentFolderId)).toBe(FOLDER);
    expect(page.applied).toEqual(['f1#1', 'f1#2']);

    await page.sync(fetchFolder); // unchanged key
    expect(loads).toBe(2);
  });

  it('drops the response of a superseded matrix load', async () => {
    workspaceScope.update((s) => ({ ...s, selectedId: 'ws-a' }));
    currentFolderId.set(FOLDER);
    const page = createPage();
    let releaseFirst: (v: string) => void = () => {};
    const slow = () => new Promise<string>((r) => (releaseFirst = r));
    const first = page.sync(slow);
    workspaceScope.update((s) => ({ ...s, selectedId: 'ws-b' }));
    await page.sync(async () => 'second');
    releaseFirst('first');
    await first;
    expect(page.applied).toEqual(['second']);
  });
});
