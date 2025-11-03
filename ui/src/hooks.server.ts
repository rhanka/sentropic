import type { Handle } from '@sveltejs/kit';
import { API_BASE_URL } from '$lib/config';

/**
 * SvelteKit Server Hooks
 * 
 * Handle server-side route guards and redirections.
 * Check session validity for protected routes.
 */

// Protected routes that require authentication
const PROTECTED_ROUTES = [
  '/dashboard',
  '/dossiers',
  '/entreprises',
  '/cas-usage',
  '/matrice',
  '/parametres',
  '/configuration-metier',
  '/donnees',
  '/auth/devices',
];

// Admin routes that require admin role
const ADMIN_ROUTES = [
  '/parametres',
  '/configuration-metier',
];

/**
 * Check if session is valid by calling API
 */
async function validateSession(cookies: string): Promise<{ valid: boolean; role?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/session`, {
      headers: {
        cookie: cookies,
      },
    });

    if (res.ok) {
      const data = await res.json();
      return { valid: true, role: data.role };
    }

    return { valid: false };
  } catch (error) {
    console.error('Session validation error:', error);
    return { valid: false };
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  
  // Allow public routes: only '/' (exact match) and routes starting with '/auth'
  const isPublicRoute = path === '/' || path.startsWith('/auth');
  
  if (isPublicRoute) {
    return resolve(event);
  }
  
  // All other routes require authentication
  // Get session cookie
  const sessionCookie = event.cookies.get('session');
  
  if (!sessionCookie) {
    // No session, redirect to login
    return new Response(null, {
      status: 302,
      headers: {
        location: `/auth/login?returnUrl=${encodeURIComponent(path)}`,
      },
    });
  }
  
  // Validate session with API
  const { valid, role } = await validateSession(event.request.headers.get('cookie') || '');
  
  if (!valid) {
    // Invalid session, redirect to login
    return new Response(null, {
      status: 302,
      headers: {
        location: `/auth/login?returnUrl=${encodeURIComponent(path)}`,
      },
    });
  }
  
  // Check if route is protected (for specific route handling)
  const isProtectedRoute = PROTECTED_ROUTES.some(route => path.startsWith(route));
  const isAdminRoute = ADMIN_ROUTES.some(route => path.startsWith(route));
  
  // Check admin routes
  if (isAdminRoute && role !== 'admin_app' && role !== 'admin_org') {
    // Insufficient permissions, redirect to error or dashboard
    return new Response(null, {
      status: 302,
      headers: {
        location: '/dashboard?error=insufficient_permissions',
      },
    });
  }
  
  // Attach user info to locals for use in pages
  event.locals.user = {
    role: role as any,
  };
  
  return resolve(event);
};

