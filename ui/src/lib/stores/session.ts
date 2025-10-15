import { writable, derived } from 'svelte/store';
import { API_BASE_URL } from '$lib/config';
import { goto } from '$app/navigation';

/**
 * Session Store
 * 
 * Manages user session state:
 * - Current user info (id, email, displayName, role)
 * - Authentication status
 * - Role-based helpers
 * - Logout functionality
 */

export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  role: 'admin_app' | 'admin_org' | 'editor' | 'guest';
}

export interface SessionState {
  user: User | null;
  loading: boolean;
}

// Create writable store
const sessionStore = writable<SessionState>({
  user: null,
  loading: true,
});

// Derived store for authentication status
export const isAuthenticated = derived(
  sessionStore,
  ($session) => $session.user !== null
);

// Derived store for loading state
export const isLoadingSession = derived(
  sessionStore,
  ($session) => $session.loading
);

/**
 * Initialize session from server
 * Call this on app startup
 */
export async function initializeSession(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/session`, {
      credentials: 'include', // Send session cookie
    });

    if (res.ok) {
      const data = await res.json();
      
      // Get full user info (would need a /users/:id endpoint)
      // For now, use session data
      sessionStore.set({
        user: {
          id: data.userId,
          email: null,
          displayName: null,
          role: data.role,
        },
        loading: false,
      });
    } else {
      // No valid session
      sessionStore.set({ user: null, loading: false });
    }
  } catch (error) {
    console.error('Failed to initialize session:', error);
    sessionStore.set({ user: null, loading: false });
  }
}

/**
 * Set current user (after login/registration)
 */
export function setUser(user: User): void {
  sessionStore.update(state => ({ ...state, user }));
}

/**
 * Clear current user (after logout)
 */
export function clearUser(): void {
  sessionStore.set({ user: null, loading: false });
}

/**
 * Check if user has specific role
 */
export function hasRole(role: User['role']): boolean {
  let currentUser: User | null = null;
  
  const unsubscribe = sessionStore.subscribe(state => {
    currentUser = state.user;
  });
  unsubscribe();
  
  if (!currentUser) return false;
  
  const roleHierarchy = {
    admin_app: 4,
    admin_org: 3,
    editor: 2,
    guest: 1,
  };
  
  return roleHierarchy[currentUser.role] >= roleHierarchy[role];
}

/**
 * Check if user is admin (admin_app or admin_org)
 */
export function isAdmin(): boolean {
  let currentUser: User | null = null;
  
  const unsubscribe = sessionStore.subscribe(state => {
    currentUser = state.user;
  });
  unsubscribe();
  
  return currentUser?.role === 'admin_app' || currentUser?.role === 'admin_org';
}

/**
 * Logout current user
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/auth/session`, {
      method: 'DELETE',
      credentials: 'include', // Send session cookie
    });
  } catch (error) {
    console.error('Logout request failed:', error);
  } finally {
    // Clear user even if request fails
    clearUser();
    
    // Clear session storage
    sessionStorage.removeItem('sessionToken');
    sessionStorage.removeItem('refreshToken');
    
    // Redirect to login
    goto('/auth/login');
  }
}

/**
 * Logout from all devices
 */
export async function logoutAll(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/auth/session/all`, {
      method: 'DELETE',
      credentials: 'include', // Send session cookie
    });
  } catch (error) {
    console.error('Logout all request failed:', error);
  } finally {
    // Clear user even if request fails
    clearUser();
    
    // Clear session storage
    sessionStorage.removeItem('sessionToken');
    sessionStorage.removeItem('refreshToken');
    
    // Redirect to login
    goto('/auth/login');
  }
}

// Export the store
export const session = {
  subscribe: sessionStore.subscribe,
  initializeSession,
  setUser,
  clearUser,
  hasRole,
  isAdmin,
  logout,
  logoutAll,
};

