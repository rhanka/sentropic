import {
  createDefaultFetchTransport,
  createDefaultAuthUiLabels,
  createFrenchAuthUiLabels,
  type AuthUiLabels,
  type AuthUiTransport,
} from '@sentropic/auth-ui';

import { apiFetch } from '$lib/utils/api';

/**
 * Sentropic adapter for `@sentropic/auth-ui`.
 *
 * The package is host-adapter driven so Sentropic and `spa-transpose-cv`
 * can both consume the same Svelte components. Sentropic mounts the
 * Hono auth routes under `/auth/*` and authenticates via cookies (the
 * shared session cookie set by `@sentropic/auth-hono`).
 */
export const createSentropicAuthTransport = (
  options: { onUnauthorized?: () => void } = {},
): AuthUiTransport =>
  createDefaultFetchTransport({
    baseUrl: '/auth',
    fetch: (input, init) => apiFetch(input, init),
    onUnauthorized: options.onUnauthorized,
  });

/**
 * Pick the FR or EN label preset that matches the current Sentropic locale.
 */
export const resolveAuthUiLabels = (locale: string | null | undefined): AuthUiLabels => {
  const normalized = (locale ?? 'fr').toLowerCase();
  return normalized.startsWith('fr') ? createFrenchAuthUiLabels() : createDefaultAuthUiLabels();
};
