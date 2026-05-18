import { createNotBoundHandlers } from '../not-bound.js';

export const foldersToolNames = [
  'folders_list',
  'folder_get',
  'folder_update',
] as const;

export const foldersHandlers = createNotBoundHandlers('folders', foldersToolNames);
