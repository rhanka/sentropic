import { Hono } from 'hono';
import { registerRouter } from './register';
import { loginRouter } from './login';

/**
 * Authentication Routes
 * 
 * Main auth router that aggregates all auth-related routes:
 * - /auth/register/* - WebAuthn registration
 * - /auth/login/* - WebAuthn authentication
 * - /auth/session/* - Session management (to be added)
 * - /auth/credentials/* - Credential management (to be added)
 * - /auth/magic-link/* - Magic link authentication (to be added)
 */

export const authRouter = new Hono();

// Mount sub-routers
authRouter.route('/register', registerRouter);
authRouter.route('/login', loginRouter);

// Health check
authRouter.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'auth' });
});
