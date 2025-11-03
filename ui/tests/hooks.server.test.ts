import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock API_BASE_URL before importing handle
vi.mock('../../src/lib/config', () => ({
  API_BASE_URL: 'http://localhost:8787',
}));

import { handle } from '../src/hooks.server';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Helper to create mock event
function createMockEvent(path: string, sessionCookie?: string) {
  // Create fresh mocks for each event
  const cookies = {
    get: vi.fn().mockReturnValue(sessionCookie || null),
  };
  const headers = {
    get: vi.fn().mockReturnValue(sessionCookie ? `session=${sessionCookie}` : ''),
  };

  return {
    url: {
      pathname: path,
    },
    cookies: cookies,
    request: {
      headers: headers,
    },
    locals: {},
  };
}

describe('Server Hooks - Route Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Don't set default rejection - let each test configure its own mock
  });

  describe('Public routes', () => {
    it('should allow access to login page', async () => {
      const event = createMockEvent('/auth/login');
      const resolve = vi.fn().mockResolvedValue(new Response());

      await handle({ event, resolve } as any);

      expect(resolve).toHaveBeenCalledWith(event);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should allow access to register page', async () => {
      const event = createMockEvent('/auth/register');
      const resolve = vi.fn().mockResolvedValue(new Response());

      await handle({ event, resolve } as any);

      expect(resolve).toHaveBeenCalledWith(event);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should allow access to home page', async () => {
      const event = createMockEvent('/');
      const resolve = vi.fn().mockResolvedValue(new Response());

      await handle({ event, resolve } as any);

      expect(resolve).toHaveBeenCalledWith(event);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Protected routes', () => {
    it('should redirect to login when no session cookie', async () => {
      const event = createMockEvent('/dashboard');
      const resolve = vi.fn().mockResolvedValue(new Response());

      const response = await handle({ event, resolve } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/auth/login?returnUrl=%2Fdashboard');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('should redirect to login when session is invalid', async () => {
      const event = createMockEvent('/dashboard', 'invalid-session');
      
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const resolve = vi.fn().mockResolvedValue(new Response());
      const response = await handle({ event, resolve } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/auth/login?returnUrl=%2Fdashboard');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('should allow access when session is valid', async () => {
      const event = createMockEvent('/dashboard', 'valid-session');
      const mockResponse = new Response();
      
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: '123', role: 'guest' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const resolve = vi.fn().mockResolvedValue(mockResponse);
      const response = await handle({ event, resolve } as any);

      expect(response).toBe(mockResponse);
      expect(resolve).toHaveBeenCalledWith(event);
      expect(event.locals.user).toEqual({ role: 'guest' });
    });

    it('should preserve returnUrl in redirect', async () => {
      const event = createMockEvent('/dossiers/123');
      const resolve = vi.fn().mockResolvedValue(new Response());

      const response = await handle({ event, resolve } as any);

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/auth/login?returnUrl=%2Fdossiers%2F123');
    });
  });

  describe('Admin routes', () => {
    it('should allow access for admin_app role', async () => {
      const event = createMockEvent('/parametres', 'admin-session');
      const mockResponse = new Response();
      
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: '123', role: 'admin_app' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const resolve = vi.fn().mockResolvedValue(mockResponse);
      const response = await handle({ event, resolve } as any);

      expect(response).toBe(mockResponse);
      expect(resolve).toHaveBeenCalledWith(event);
    });

    it('should allow access for admin_org role', async () => {
      const event = createMockEvent('/parametres', 'admin-session');
      const mockResponse = new Response();
      
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: '123', role: 'admin_org' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const resolve = vi.fn().mockResolvedValue(mockResponse);
      const response = await handle({ event, resolve } as any);

      expect(response).toBe(mockResponse);
      expect(resolve).toHaveBeenCalledWith(event);
    });

    it('should redirect to dashboard for non-admin users', async () => {
      const event = createMockEvent('/parametres', 'guest-session');
      
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: '123', role: 'guest' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const resolve = vi.fn().mockResolvedValue(new Response());
      const response = await handle({ event, resolve } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/dashboard?error=insufficient_permissions');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('should redirect to dashboard for editor role accessing admin route', async () => {
      const event = createMockEvent('/configuration-metier', 'editor-session');
      
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: '123', role: 'editor' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const resolve = vi.fn().mockResolvedValue(new Response());
      const response = await handle({ event, resolve } as any);

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/dashboard?error=insufficient_permissions');
    });
  });

  describe('Route matching', () => {
    it('should protect routes starting with protected path', async () => {
      const event = createMockEvent('/dossiers/123/subroute');
      
      // No session cookie, should redirect without calling fetch
      const resolve = vi.fn().mockResolvedValue(new Response());
      const response = await handle({ event, resolve } as any);

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/auth/login');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should require authentication for non-public routes', async () => {
      const event = createMockEvent('/some-other-route');
      const resolve = vi.fn().mockResolvedValue(new Response());
      
      // No session cookie, should redirect to login
      const response = await handle({ event, resolve } as any);

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/auth/login');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const event = createMockEvent('/dashboard', 'session');
      
      // Mock fetch to throw error (simulating network error)
      // Override the default rejection from beforeEach
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const resolve = vi.fn().mockResolvedValue(new Response());
      const response = await handle({ event, resolve } as any);

      // validateSession catches errors and returns { valid: false }, so should redirect
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/auth/login');
    });
  });
});

