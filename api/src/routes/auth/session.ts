import { createAuthSessionRouteHandlers } from '@sentropic/auth-hono';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { logger } from '../../logger';
import {
  authHonoCookiePort,
  authHonoSessionService,
} from '../../services/auth/session-adapter';
import {
  createSession,
  listUserSessions,
  revokeAllSessions,
  validateSession,
} from '../../services/session-manager';

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

const extensionIssueSchema = z.object({
  deviceName: z.string().min(1).max(100).optional(),
});

const sessionHandlers = createAuthSessionRouteHandlers({
  cookies: authHonoCookiePort,
  service: authHonoSessionService,
});

/**
 * GET /auth/session
 * Get current session info (requires valid session)
 */
sessionRouter.get('/', async (c) => {
  try {
    const sessionToken =
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');

    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }

    const session = await validateSession(sessionToken);

    if (!session) {
      return c.json({ error: 'Invalid or expired session' }, 401);
    }

    const [userRecord] = await db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    return c.json({
      userId: session.userId,
      sessionId: session.sessionId,
      role: session.role,
      email: userRecord?.email ?? null,
      displayName: userRecord?.displayName ?? null,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error getting session info');
    return c.json({ error: 'Failed to get session info' }, 500);
  }
});

/**
 * POST /auth/session/refresh
 * Refresh session using refresh token (@sentropic/auth-hono)
 */
sessionRouter.post('/refresh', sessionHandlers.refreshSession!);

/**
 * POST /auth/session/extension-token
 * Exchange an authenticated app session (cookie or bearer) for a dedicated extension session token pair.
 */
sessionRouter.post('/extension-token', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { deviceName } = extensionIssueSchema.parse(body);

    const sessionToken =
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');

    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }

    const currentSession = await validateSession(sessionToken);

    if (!currentSession) {
      return c.json({ error: 'Invalid or expired session' }, 401);
    }

    const [userRecord] = await db
      .select({
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, currentSession.userId))
      .limit(1);

    const issued = await createSession(currentSession.userId, currentSession.role, {
      name: deviceName || 'Top AI Ideas Extension',
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined,
      userAgent: c.req.header('user-agent') || undefined,
    });

    return c.json({
      success: true,
      user: {
        id: currentSession.userId,
        email: userRecord?.email ?? null,
        displayName: userRecord?.displayName ?? null,
        role: currentSession.role,
      },
      sessionToken: issued.sessionToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }

    logger.error({ err: error }, 'Error issuing extension session token');
    return c.json({ error: 'Failed to issue extension session token' }, 500);
  }
});

/**
 * DELETE /auth/session
 * Logout current session (@sentropic/auth-hono)
 */
sessionRouter.delete('/', sessionHandlers.logout!);

/**
 * DELETE /auth/session/all
 * Logout all sessions (revoke all user sessions)
 */
sessionRouter.delete('/all', async (c) => {
  try {
    const sessionToken =
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');

    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }

    const session = await validateSession(sessionToken);

    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }

    await revokeAllSessions(session.userId);

    c.header('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');

    logger.info({ userId: session.userId }, 'All sessions logged out');

    return c.json({ success: true, message: 'Logged out from all devices' });
  } catch (error) {
    logger.error({ err: error }, 'Error logging out all sessions');
    return c.json({ error: 'Failed to logout from all devices' }, 500);
  }
});

/**
 * GET /auth/session/list
 * List all active sessions for current user
 */
sessionRouter.get('/list', async (c) => {
  try {
    const sessionToken =
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');

    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }

    const session = await validateSession(sessionToken);

    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }

    const sessions = await listUserSessions(session.userId);

    return c.json({ sessions });
  } catch (error) {
    logger.error({ err: error }, 'Error listing sessions');
    return c.json({ error: 'Failed to list sessions' }, 500);
  }
});
