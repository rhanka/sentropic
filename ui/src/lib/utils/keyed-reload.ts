// Keyed reload guard: a page that loads data into a shared store must reload it
// whenever its key (e.g. `${folderId}:${workspaceId}`) changes, because the root
// layout wipes those stores on scope change. A sequence token drops responses
// of superseded loads.
export type KeyedReload = {
  needsReload: (key: string) => boolean;
  begin: (key: string) => number;
  isCurrent: (token: number) => boolean;
};

export const createKeyedReload = (): KeyedReload => {
  let loadedKey: string | null = null;
  let seq = 0;
  return {
    needsReload: (key) => key !== loadedKey,
    begin: (key) => {
      loadedKey = key;
      return ++seq;
    },
    isCurrent: (token) => token === seq,
  };
};

export const folderScopeKey = (folderId: string, workspaceId: string | null | undefined): string =>
  `${folderId}:${workspaceId ?? ''}`;
