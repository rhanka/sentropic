/**
 * @deprecated Use session store instead from './session'
 * This file is kept for backward compatibility
 */
import { writable } from 'svelte/store';

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
};

// Re-export from session store for backward compatibility
export { session as sessionStore, isAuthenticated } from './session';
export const userStore = writable<UserProfile | null>(null);
