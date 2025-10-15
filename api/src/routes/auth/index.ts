import { Hono } from 'hono';
import { registerRouter } from './register';
import { loginRouter } from './login';
import { sessionRouter } from './session';
import { credentialsRouter } from './credentials';
import { magicLinkRouter } from './magic-link';

/**
 * Authentication Routes
 * 
 * Main auth router that aggregates all auth-related routes:
 * - /auth/register/* - WebAuthn registration
 * - /auth/login/* - WebAuthn authentication
 * - /auth/session/* - Session management
 * - /auth/credentials/* - Credential management
 * - /auth/magic-link/* - Magic link authentication
 */

export const authRouter = new Hono();

// Mount sub-routers
authRouter.route('/register', registerRouter);
authRouter.route('/login', loginRouter);
authRouter.route('/session', sessionRouter);
authRouter.route('/credentials', credentialsRouter);
authRouter.route('/magic-link', magicLinkRouter);

// Health check
authRouter.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'auth' });
});
