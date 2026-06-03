import { browser } from '$app/environment';

// BR-39m A0-bis — minimal same-origin API client for the IdP screens front.
// Mirrors the product `ui/` `apiFetch` contract (credentials: include, the
// `X-App-Locale` header, ApiError on non-2xx) but WITHOUT the product-only
// concerns (cowork-bridge token, workspace scoping). The IdP screens are served
// same-origin with the IdP OIDC API, so every auth request is a relative path
// under the IdP origin and the session cookie is naturally same-origin.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const resolveLocale = (): string => {
  if (!browser) return 'fr';
  const raw = (localStorage.getItem('locale') ?? 'fr').trim().toLowerCase();
  return raw.startsWith('en') ? 'en' : 'fr';
};

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const url = endpoint.startsWith('http') ? endpoint : endpoint;
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-App-Locale': resolveLocale(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: 'Unknown error',
      message: 'Unknown error',
    }));
    const rawMessage =
      (errorData as { message?: unknown })?.message ??
      (errorData as { error?: unknown })?.error ??
      `HTTP ${response.status}: ${response.statusText}`;
    const errorMessage =
      typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
    throw new ApiError(errorMessage, response.status, errorData);
  }

  return response;
}
