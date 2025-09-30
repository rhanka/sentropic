import { writable } from 'svelte/store';
import type { MatrixConfig } from './matrix';

export type Folder = {
  id: string;
  name: string;
  description?: string;
  companyId?: string;
  matrixConfig?: MatrixConfig;
};

export const foldersStore = writable<Folder[]>([]);
export const currentFolderId = writable<string | null>(null);
