import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { resetFetchMock } from '../test-setup';

// Import mocked goto from $app/navigation
import { goto as mockGoto } from '$app/navigation';

// Mock apiGetAuth BEFORE importing session store
// Use factory function to avoid hoisting issues
vi.mock('../../src/lib/utils/api', async () => {
  const actual = await vi.importActual('../../src/lib/utils/api');
  const mockApiGetAuth = vi.fn();
  return {
    ...actual,
    apiGetAuth: mockApiGetAuth,
  };
});

// Import the mocked apiGetAuth
import { apiGetAuth as mockApiGetAuth } from '../../src/lib/utils/api';

// Now import the session store after mocks are set up
import {
  session,
  initializeSession,
  setUser,
  clearUser,
  hasRole,
  isAdmin,
  logout,
  logoutAll,
  isAuthenticated,
  isLoadingSession,
} from '../../src/lib/stores/session';
import type { User } from '../../src/lib/stores/session';

describe('Session Store', () => {
  beforeEach(() => {
    resetFetchMock();
    localStorage.clear();
    sessionStorage.clear();
    clearUser();
    vi.clearAllMocks();
    mockGoto.mockClear();
  });

  describe('isAuthenticated', () => {
    it('should return false when user is null', () => {
      clearUser();
      expect(get(isAuthenticated)).toBe(false);
    });

    it('should return true when user exists', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };
      setUser(user);
      expect(get(isAuthenticated)).toBe(true);
    });
  });

  describe('isLoadingSession', () => {
    it('should return false when not loading', () => {
      clearUser();
      expect(get(isLoadingSession)).toBe(false);
    });
  });

  describe('setUser', () => {
    it('should update store and localStorage', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };

      setUser(user);

      const state = get(session);
      expect(state.user).toEqual(user);

      const stored = localStorage.getItem('userSession');
      expect(stored).toBeTruthy();
      const sessionData = JSON.parse(stored!);
      expect(sessionData.user).toEqual(user);
      expect(sessionData.timestamp).toBeGreaterThan(0);
    });
  });

  describe('clearUser', () => {
    it('should clear store and localStorage', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };

      setUser(user);
      clearUser();

      const state = get(session);
      expect(state.user).toBeNull();

      expect(localStorage.getItem('userSession')).toBeNull();
    });
  });

  describe('hasRole', () => {
    it('should return false when user is null', () => {
      clearUser();
      expect(hasRole('guest')).toBe(false);
    });

    it('should return true for same role', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };
      setUser(user);
      expect(hasRole('guest')).toBe(true);
    });

    it('should return true for higher role', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'admin_app',
      };
      setUser(user);
      expect(hasRole('guest')).toBe(true);
      expect(hasRole('editor')).toBe(true);
      expect(hasRole('admin_app')).toBe(true);
    });

    it('should return false for lower role', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };
      setUser(user);
      expect(hasRole('editor')).toBe(false);
      expect(hasRole('admin_app')).toBe(false);
    });
  });

  describe('isAdmin', () => {
    it('should return false when user is null', () => {
      clearUser();
      expect(isAdmin()).toBe(false);
    });

    it('should return true for admin_app', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'admin_app',
      };
      setUser(user);
      expect(isAdmin()).toBe(true);
    });

    it('should return true for admin_org', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'admin_org',
      };
      setUser(user);
      expect(isAdmin()).toBe(true);
    });

    it('should return false for guest', () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };
      setUser(user);
      expect(isAdmin()).toBe(false);
    });
  });

  describe('logout', () => {
    it('should clear user and redirect to login', async () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };
      setUser(user);

      await logout();

      const state = get(session);
      expect(state.user).toBeNull();
      expect(localStorage.getItem('userSession')).toBeNull();
      expect(mockGoto).toHaveBeenCalledWith('/auth/login');
    });

    it('should clear sessionStorage', async () => {
      sessionStorage.setItem('sessionToken', 'test-token');
      sessionStorage.setItem('refreshToken', 'test-refresh');

      await logout();

      expect(sessionStorage.getItem('sessionToken')).toBeNull();
      expect(sessionStorage.getItem('refreshToken')).toBeNull();
    });
  });

  describe('logoutAll', () => {
    it('should clear user and redirect to login', async () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };
      setUser(user);

      await logoutAll();

      const state = get(session);
      expect(state.user).toBeNull();
      expect(localStorage.getItem('userSession')).toBeNull();
      expect(mockGoto).toHaveBeenCalledWith('/auth/login');
    });
  });

  describe('initializeSession', () => {
    it('should restore from localStorage if recent', async () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };

      const sessionData = {
        user,
        timestamp: Date.now(),
        cookieExists: true,
      };
      localStorage.setItem('userSession', JSON.stringify(sessionData));

      await initializeSession();

      const state = get(session);
      expect(state.user).toEqual(user);
    });

    it('should clear localStorage if too old', async () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };

      const sessionData = {
        user,
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        cookieExists: true,
      };
      localStorage.setItem('userSession', JSON.stringify(sessionData));

      vi.mocked(mockApiGetAuth).mockResolvedValue({
        status: 'auth_error',
      });

      await initializeSession();

      expect(localStorage.getItem('userSession')).toBeNull();
    });

    it('should fetch from API if no localStorage', async () => {
      const user: User = {
        id: '123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'guest',
      };

      vi.mocked(mockApiGetAuth).mockResolvedValue({
        status: 'success',
        data: {
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
      });

      await initializeSession();

      const state = get(session);
      expect(state.user).toEqual(user);

      const stored = localStorage.getItem('userSession');
      expect(stored).toBeTruthy();
    });

    it('should clear session on auth error', async () => {
      vi.mocked(mockApiGetAuth).mockResolvedValue({
        status: 'auth_error',
      });

      await initializeSession();

      const state = get(session);
      expect(state.user).toBeNull();
      expect(localStorage.getItem('userSession')).toBeNull();
    });
  });
});

