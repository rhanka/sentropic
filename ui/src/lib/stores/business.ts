import { writable } from 'svelte/store';

export type Sector = {
  id: string;
  name: string;
};

export type Process = {
  id: string;
  name: string;
};

export const businessStore = writable<{ sectors: Sector[]; processes: Process[] }>({
  sectors: [],
  processes: []
});
