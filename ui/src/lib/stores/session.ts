import { writable, derived, get } from 'svelte/store';
import { apiGet, apiDelete, ApiError } from '$lib/utils/api';
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
    const stored = localStorage.getItem('userSession');
    
    console.log('🔍 Session init debug:', {
      hasStoredData: !!stored,
      storedData: stored ? JSON.parse(stored) : null
    });
    
    if (stored) {
      try {
        const sessionData = JSON.parse(stored);
        const age = Date.now() - sessionData.timestamp;
        const maxAge = 24 * 60 * 60 * 1000;
        
        console.log('🔍 localStorage data analysis:', {
          age: age,
          maxAge: maxAge,
          ageHours: Math.round(age / (60 * 60 * 1000) * 100) / 100,
          isRecent: age < maxAge
        });
        
        if (age < maxAge) {
          console.log('✅ Restoring from localStorage:', sessionData);
          sessionStore.set({ user: sessionData.user, loading: false });
          
          console.log('🔄 Starting background validation...');
          validateSessionInBackground();
          return;
        } else {
          console.log('🗑️ localStorage data too old, clearing');
          localStorage.removeItem('userSession');
        }
      } catch (parseError) {
        console.warn('Failed to parse stored session data:', parseError);
        localStorage.removeItem('userSession');
      }
    }
    
    try {
      const data = await apiGet<{ userId: string; email?: string; displayName?: string; role: string }>('/auth/session');
      
      const user: User = {
        id: data.userId,
        email: data.email ?? null,
        displayName: data.displayName ?? null,
        role: data.role as User['role'],
      };
      
      sessionStore.set({ user, loading: false });
      
      const sessionData = {
        user,
        timestamp: Date.now(),
        cookieExists: true
      };
      localStorage.setItem('userSession', JSON.stringify(sessionData));
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 403) {
          console.log('❌ Authentication error, clearing session');
          sessionStore.set({ user: null, loading: false });
          localStorage.removeItem('userSession');
        } else if (error.status === 429) {
          console.log('⚠️ Rate limited');
          // Vérifier si on a une session valide en localStorage
          const stored = localStorage.getItem('userSession');
          if (stored) {
            try {
              const sessionData = JSON.parse(stored);
              const age = Date.now() - sessionData.timestamp;
              const maxAge = 24 * 60 * 60 * 1000;
              
              if (age < maxAge && sessionData.user) {
                // Session valide en localStorage, garder l'état actuel mais marquer comme non-loading
                const currentState = get(sessionStore);
                if (currentState.loading) {
                  sessionStore.set({ user: sessionData.user, loading: false });
                }
              } else {
                // Session localStorage expirée ou invalide, traiter comme non authentifié
                console.log('⚠️ Rate limited but localStorage session expired, clearing');
                sessionStore.set({ user: null, loading: false });
                localStorage.removeItem('userSession');
              }
            } catch (parseError) {
              console.warn('Failed to parse stored session data on rate limit:', parseError);
              sessionStore.set({ user: null, loading: false });
              localStorage.removeItem('userSession');
            }
          } else {
            // Pas de session en localStorage, traiter comme non authentifié
            console.log('⚠️ Rate limited and no localStorage session, clearing');
            sessionStore.set({ user: null, loading: false });
          }
        } else {
          // Autre erreur API, traiter comme non authentifié
          console.error('Failed to initialize session:', error);
          sessionStore.set({ user: null, loading: false });
          localStorage.removeItem('userSession');
        }
      } else {
        // Erreur non-ApiError, traiter comme non authentifié
        console.error('Failed to initialize session:', error);
        sessionStore.set({ user: null, loading: false });
        localStorage.removeItem('userSession');
      }
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
    const data = await apiGet<{ userId: string; email?: string; displayName?: string; role: string }>('/auth/session');
    
    const user: User = {
      id: data.userId,
      email: data.email ?? null,
      displayName: data.displayName ?? null,
      role: data.role as User['role'],
    };
    
    console.log('✅ Background validation: session valid, updating localStorage');
    
    const sessionData = {
      user,
      timestamp: Date.now(),
      cookieExists: true
    };
    localStorage.setItem('userSession', JSON.stringify(sessionData));
    
    const currentState = get(sessionStore);
    if (currentState.user?.id === 'unknown') {
      console.log('🔄 Background validation: updating store from unknown state');
      sessionStore.set({ user, loading: false });
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        console.warn('❌ Background validation: authentication error, clearing session');
        clearUser();
      } else if (error.status === 429) {
        console.warn('⚠️ Background validation: rate limited');
        // Vérifier si la session localStorage est encore valide
        const stored = localStorage.getItem('userSession');
        if (!stored) {
          // Pas de session en localStorage, effacer
          console.warn('⚠️ Background validation: rate limited but no localStorage session, clearing');
          clearUser();
        } else {
          try {
            const sessionData = JSON.parse(stored);
            const age = Date.now() - sessionData.timestamp;
            const maxAge = 24 * 60 * 60 * 1000;
            
            if (age >= maxAge || !sessionData.user) {
              // Session expirée ou invalide, effacer
              console.warn('⚠️ Background validation: rate limited but localStorage session expired, clearing');
              clearUser();
            }
            // Sinon, garder les données existantes (pas de modification nécessaire)
          } catch (parseError) {
            console.warn('Failed to parse stored session data on background rate limit:', parseError);
            clearUser();
          }
        }
      } else {
        console.warn('❌ Background session validation error:', error);
      }
    } else {
      console.warn('❌ Background session validation error:', error);
    }
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
  const currentState = get(sessionStore);
  const currentUser = currentState.user;
  
  if (!currentUser) return false;
  
  const roleHierarchy: Record<User['role'], number> = {
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
  const currentState = get(sessionStore);
  const currentUser = currentState.user;
  
  return currentUser?.role === 'admin_app' || currentUser?.role === 'admin_org';
}

/**
 * Logout current user
 */
export async function logout(): Promise<void> {
  try {
    // Call API to invalidate session on server
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
  // Include all cookie attributes to ensure it's removed
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax;';
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax; Secure;';
  
  // Redirect to login
  goto('/auth/login');
}

/**
 * Logout from all devices
 */
export async function logoutAll(): Promise<void> {
  try {
    // Call API to invalidate all sessions on server
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
  // Include all cookie attributes to ensure it's removed
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax;';
  document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax; Secure;';
  
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

