import { createAuthSessionRouteHandlers } from '@sentropic/auth-hono';
import { Hono } from 'hono';
import {
  authHonoCookiePort,
  authHonoSessionService,
} from '../../services/auth/session-adapter';

/**
 * Session Management Routes
 *
 * GET    /auth/session                  - Get current session info (app-owned)
 * POST   /auth/session/refresh          - Refresh session token (@sentropic/auth-hono)
 * POST   /auth/session/extension-token  - Exchange session for extension token (app-owned)
 * DELETE /auth/session                  - Logout current session (@sentropic/auth-hono)
 * DELETE /auth/session/all              - Logout all sessions (app-owned)
 * GET    /auth/session/list             - List all user sessions (app-owned)
 *
 * `refresh` and `logout` consume the package route handlers; remaining routes stay
 * app-owned because they carry Sentropic-specific workspace/extension/role policy.
 */

export const sessionRouter = new Hono();

const sessionHandlers = createAuthSessionRouteHandlers({
  cookies: authHonoCookiePort,
  service: authHonoSessionService,
});

/**
 * POST /auth/session/refresh
 * Refresh session using refresh token (@sentropic/auth-hono)
 */
sessionRouter.post('/refresh', sessionHandlers.refreshSession!);

/**
 * DELETE /auth/session
 * Logout current session (@sentropic/auth-hono)
 */
sessionRouter.delete('/', sessionHandlers.logout!);
