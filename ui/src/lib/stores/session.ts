import { writable, derived, get } from 'svelte/store';
import { apiGet, apiGetAuth, apiDelete } from '$lib/utils/api';
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
    // Check localStorage first
    const stored = localStorage.getItem('userSession');
    
    console.log('🔍 Session init debug:', {
      hasStoredData: !!stored,
      storedData: stored ? JSON.parse(stored) : null
    });
    
    if (stored) {
      // We have localStorage data, restore it immediately
      try {
        const sessionData = JSON.parse(stored);
        const age = Date.now() - sessionData.timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        console.log('🔍 localStorage data analysis:', {
          age: age,
          maxAge: maxAge,
          ageHours: Math.round(age / (60 * 60 * 1000) * 100) / 100,
          isRecent: age < maxAge
        });
        
        if (age < maxAge) {
          // Recent data, restore it
          console.log('✅ Restoring from localStorage:', sessionData);
          sessionStore.set({ user: sessionData.user, loading: false });
          
          // Validate session in background (don't block UI)
          console.log('🔄 Starting background validation...');
          validateSessionInBackground();
          return;
        } else {
          // Data too old, clear it
          console.log('🗑️ localStorage data too old, clearing');
          localStorage.removeItem('userSession');
        }
      } catch (parseError) {
        console.warn('Failed to parse stored session data:', parseError);
        localStorage.removeItem('userSession');
      }
    }
    
    // Try to get fresh session data from API
    const result = await apiGetAuth('/auth/session');
    
    if (result.status === 'success') {
      // We got valid session data
      const user = {
        id: result.data.userId,
        email: null,
        displayName: null,
        role: result.data.role,
      };
      
      sessionStore.set({ user, loading: false });
      
      // Persist the fresh data
      const sessionData = {
        user,
        timestamp: Date.now(),
        cookieExists: true
      };
      localStorage.setItem('userSession', JSON.stringify(sessionData));
    } else if (result.status === 'auth_error') {
      // Clear authentication error (401/403) - no valid session
      console.log('❌ Authentication error, clearing session');
      sessionStore.set({ user: null, loading: false });
      localStorage.removeItem('userSession');
    } else if (result.status === 'rate_limited') {
      // Rate limited - keep existing data, don't clear
      console.log('⚠️ Rate limited, keeping existing session data');
      // Don't change anything, keep localStorage as is
    }
  } catch (error) {
    console.error('Failed to initialize session:', error);
    sessionStore.set({ user: null, loading: false });
    localStorage.removeItem('userSession');
  }
}

/**
 * Validate session in background (non-blocking)
 */
async function validateSessionInBackground(): Promise<void> {
  console.log('🔄 Background validation started...');
  try {
    const result = await apiGetAuth('/auth/session');
    console.log('🔄 Background validation result:', result.status);
    
    if (result.status === 'success') {
      // Session is valid, update with fresh data if needed
      const user = {
        id: result.data.userId,
        email: null,
        displayName: null,
        role: result.data.role,
      };
      
      console.log('✅ Background validation: session valid, updating localStorage');
      
      // Update localStorage with fresh data
      const sessionData = {
        user,
        timestamp: Date.now(),
        cookieExists: true
      };
      localStorage.setItem('userSession', JSON.stringify(sessionData));
      
      // Update store only if user was in "unknown" state
      const currentState = get(sessionStore);
      if (currentState.user?.id === 'unknown') {
        console.log('🔄 Background validation: updating store from unknown state');
        sessionStore.set({ user, loading: false });
      }
    } else if (result.status === 'auth_error') {
      // Clear authentication error (401/403) - clear everything
      console.warn('❌ Background validation: authentication error, clearing session');
      clearUser();
    } else if (result.status === 'rate_limited') {
      // Rate limited - keep existing data, don't clear
      console.warn('⚠️ Background validation: rate limited, keeping existing data');
      // Don't change anything, keep localStorage as is
    }
  } catch (error) {
    console.warn('❌ Background session validation error:', error);
    // Don't clear session on network errors, just log
  }
}

/**
 * Set current user (after login/registration)
 */
export function setUser(user: User): void {
  console.log('💾 Saving user to store and localStorage:', user);
  sessionStore.update(state => ({ ...state, user }));
  
  // Persist user data in localStorage
  const sessionData = {
    user,
    timestamp: Date.now(),
    cookieExists: true
  };
  localStorage.setItem('userSession', JSON.stringify(sessionData));
  console.log('✅ User data saved to localStorage');
}

/**
 * Retry session initialization (useful when rate limited)
 * This will attempt to get real user info if we're in a "unknown" state
 */
export async function retrySessionInit(): Promise<void> {
  const currentState = get(sessionStore);
  
  // Only retry if we're in an "unknown" state
  if (currentState.user?.id === 'unknown') {
    console.log('Retrying session initialization...');
    await initializeSession();
  }
}

/**
 * Clear current user (after logout)
 */
export function clearUser(): void {
  console.log('🗑️ clearUser() called - clearing session and localStorage');
  sessionStore.set({ user: null, loading: false });
  // Clear localStorage data
  localStorage.removeItem('userSession');
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
    await apiDelete('/auth/session');
  } catch (error) {
    console.error('Logout request failed:', error);
    // Continue with logout even if API call fails (rate limiting, etc.)
  }
  
  // Always clear local state regardless of API response
  clearUser();
  
  // Clear session storage
  sessionStorage.removeItem('sessionToken');
  sessionStorage.removeItem('refreshToken');
  
  // Clear session cookie by setting it to expire in the past
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  
  // Redirect to login
  goto('/auth/login');
}

/**
 * Logout from all devices
 */
export async function logoutAll(): Promise<void> {
  try {
    await apiDelete('/auth/session/all');
  } catch (error) {
    console.error('Logout all request failed:', error);
    // Continue with logout even if API call fails
  }
  
  // Always clear local state regardless of API response
  clearUser();
  
  // Clear session storage
  sessionStorage.removeItem('sessionToken');
  sessionStorage.removeItem('refreshToken');
  
  // Clear session cookie by setting it to expire in the past
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  
  // Redirect to login
  goto('/auth/login');
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
  retrySessionInit,
  validateSessionInBackground,
};

