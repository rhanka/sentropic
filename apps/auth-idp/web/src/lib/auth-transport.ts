import {
  createDefaultFetchTransport,
  createDefaultAuthUiLabels,
  createFrenchAuthUiLabels,
  type AuthUiLabels,
  type AuthUiTransport,
} from '@sentropic/auth-ui';

import { apiFetch } from '$lib/api';

// BR-39m A0-bis — IdP-origin adapter for `@sentropic/auth-ui`.
//
// This is the line-by-line analog of the product `ui/`
// `src/lib/services/auth-transport.ts`, with ONE difference: the IdP serves
// these screens SAME-ORIGIN with its OIDC API, so the transport baseUrl is the
// absolute IdP auth mount `/api/v1/auth` (the IdP projects the shared `/auth`
// module there), not the product app's reverse-proxied `/auth`. Same-origin =
// the session cookie set by `@sentropic/auth-hono` is naturally first-party at
// the IdP origin (the whole point of A0-bis: clean cookies on auth.sent-tech.ca).
export const createIdpAuthTransport = (
  options: { onUnauthorized?: () => void } = {},
): AuthUiTransport =>
  createDefaultFetchTransport({
    baseUrl: '/api/v1/auth',
    fetch: (input, init) => apiFetch(input, init),
    onUnauthorized: options.onUnauthorized,
  });

// Pick the FR or EN label preset that matches the active locale (default FR).
export const resolveAuthUiLabels = (locale: string | null | undefined): AuthUiLabels => {
  const normalized = (locale ?? 'fr').toLowerCase();
  return normalized.startsWith('fr') ? createFrenchAuthUiLabels() : createDefaultAuthUiLabels();
};
