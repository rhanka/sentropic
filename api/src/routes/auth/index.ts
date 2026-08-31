import { Hono } from 'hono';
import { registerRouter } from '../namespaces/auth/registration';
import { loginRouter } from '../namespaces/auth/authentication';
import { credentialsRouter } from '../namespaces/auth/credentials';
import { magicLinkRouter } from '../namespaces/auth/magic-link';
import { emailRouter } from '../namespaces/auth/email';
import { federationRouter } from '../namespaces/auth/federation';

/**
 * Authentication Routes
 * 
 * Main auth router that aggregates all auth-related routes:
 * - /auth/register/* - WebAuthn registration
 * - /auth/login/* - WebAuthn authentication
 * Session and device lifecycle routes are authored by the Cluster Mesh `/session` module.
 * - /auth/credentials/* - Credential management
 * - /auth/magic-link/* - Magic link authentication
 */

export const authRouter = new Hono();

// Mount sub-routers
authRouter.route('/register', registerRouter);
authRouter.route('/login', loginRouter);
authRouter.route('/credentials', credentialsRouter);
authRouter.route('/magic-link', magicLinkRouter);
authRouter.route('/email', emailRouter);
authRouter.route('/federation', federationRouter);

// Health check
authRouter.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'auth' });
});
