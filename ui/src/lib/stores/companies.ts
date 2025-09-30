import { writable } from 'svelte/store';

export type Company = {
  id: string;
  name: string;
  industry?: string;
  size?: string;
  products?: string;
  processes?: string;
  challenges?: string;
  objectives?: string;
  technologies?: string;
};

export const companiesStore = writable<Company[]>([]);
export const currentCompanyId = writable<string | null>(null);
