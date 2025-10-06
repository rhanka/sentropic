import { writable } from 'svelte/store';

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
};

export const userStore = writable<UserProfile | null>(null);
