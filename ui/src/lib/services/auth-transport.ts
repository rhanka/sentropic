import {
  createDefaultFetchTransport,
  createDefaultAuthUiLabels,
  createFrenchAuthUiLabels,
  type AuthUiLabels,
  type AuthUiTransport,
  type AuthUiUser,
} from '@sentropic/auth-ui';

import type { User } from '$lib/stores/session';
import { apiFetch } from '$lib/utils/api';

const VALID_ROLES = ['admin_app', 'admin_org', 'editor', 'guest'] as const;
type UserRole = (typeof VALID_ROLES)[number];

/**
 * Map an AuthUiUser (from the package) onto the Sentropic store `User` shape,
 * coercing unknown roles to `'guest'` so a stale/misconfigured backend cannot
 * leak undeclared roles into the session store.
 */
export const toSentropicUser = (authUser: AuthUiUser): User => {
  const role = authUser.role && (VALID_ROLES as readonly string[]).includes(authUser.role)
    ? (authUser.role as UserRole)
    : 'guest';
  return {
    id: authUser.id,
    email: authUser.email ?? null,
    displayName: authUser.displayName ?? null,
    role,
  };
};

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
