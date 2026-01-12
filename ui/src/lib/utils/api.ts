/**
 * API Utility Functions
 * 
 * Centralized API calling utilities with authentication support.
 */

import { browser } from '$app/environment';
import { API_BASE_URL } from '$lib/config';
import { getScopedWorkspaceIdForAdmin } from '$lib/stores/adminWorkspaceScope';
import { getScopedWorkspaceIdForUser } from '$lib/stores/workspaceScope';

/**
 * Custom error class for API errors that preserves error details
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Make an authenticated API request
 * Automatically includes credentials (cookies) for authentication
 */
export async function apiRequest<T = any>(
  endpoint: string, 
  options: RequestInit = {}
): Promise<T> {
  const rawUrl = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  // Attach workspace scope (stored in localStorage) as `workspace_id` query param.
  // - admin_app uses admin scope store
  // - regular users use workspace scope store
  const scoped = getScopedWorkspaceIdForAdmin() ?? getScopedWorkspaceIdForUser();
  const url = (() => {
    if (!scoped) return rawUrl;
    // Never scope auth endpoints
    if (endpoint.startsWith('/auth') || rawUrl.includes('/auth/')) return rawUrl;
    if (!browser) return rawUrl;
    const u = new URL(rawUrl, window.location.origin);
    if (!u.searchParams.has('workspace_id')) u.searchParams.set('workspace_id', scoped);
    return u.toString();
  })();
  
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Always include cookies for authentication
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ 
      error: 'Unknown error', 
      message: 'Unknown error' 
    }));
    
    // Use message field first (REST API standard), fallback to error field
    const rawMessage = (errorData as any)?.message ?? (errorData as any)?.error ?? `HTTP ${response.status}: ${response.statusText}`;
    const errorMessage =
      typeof rawMessage === 'string'
        ? rawMessage
        : (() => {
            try {
              return JSON.stringify(rawMessage);
            } catch {
              return String(rawMessage);
            }
          })();
    
    throw new ApiError(errorMessage, response.status, errorData);
  }

  // Handle 204 No Content responses (common for DELETE)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/**
 * Make a GET request to an API endpoint
 */
export async function apiGet<T = any>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'GET' });
}

/**
 * Make a POST request to an API endpoint
 */
export async function apiPost<T = any>(endpoint: string, data?: any): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Make a PUT request to an API endpoint
 */
export async function apiPut<T = any>(endpoint: string, data?: any): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Make a PATCH request to an API endpoint
 */
export async function apiPatch<T = any>(endpoint: string, data?: any): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Make a DELETE request to an API endpoint
 */
export async function apiDelete<T = any>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'DELETE' });
}
