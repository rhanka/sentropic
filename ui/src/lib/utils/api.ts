/**
 * API Utility Functions
 * 
 * Centralized API calling utilities with authentication support.
 */

import { API_BASE_URL } from '$lib/config';

/**
 * Make an authenticated API request
 * Automatically includes credentials (cookies) for authentication
 */
export async function apiRequest<T = any>(
  endpoint: string, 
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Always include cookies for authentication
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  // Handle 204 No Content responses (common for DELETE)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/**
 * Make an authenticated API request that handles auth errors gracefully
 * Used for session checks where 401/403 are expected when not authenticated
 */
export async function apiRequestAuth<T = any>(
  endpoint: string, 
  options: RequestInit = {}
): Promise<{ data: T; status: 'success' } | { data: null; status: 'auth_error' | 'rate_limited' }> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Always include cookies for authentication
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Handle auth errors gracefully
  if (response.status === 401 || response.status === 403) {
    return { data: null, status: 'auth_error' };
  }
  
  if (response.status === 429) {
    return { data: null, status: 'rate_limited' };
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return { data: await response.json(), status: 'success' };
}

/**
 * Make a GET request to an API endpoint
 */
export async function apiGet<T = any>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'GET' });
}

/**
 * Make a GET request to an API endpoint with graceful auth error handling
 */
export async function apiGetAuth<T = any>(endpoint: string): Promise<{ data: T; status: 'success' } | { data: null; status: 'auth_error' | 'rate_limited' }> {
  return apiRequestAuth<T>(endpoint, { method: 'GET' });
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
 * Make a DELETE request to an API endpoint
 */
export async function apiDelete<T = any>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'DELETE' });
}
