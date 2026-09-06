import { createAuthSessionRouteHandlers } from '@sentropic/auth-hono';
import type { SessionRouteHandlers } from '@sentropic/cluster-mesh';
import type { Context } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  authHonoCookiePort,
  authHonoSessionService,
  findSessionUser,
} from '../../services/auth/session-adapter';
import {
  createSession,
  listUserSessions,
  revokeAllSessions,
  validateSession,
} from '../../services/session-manager';

const extensionIssueSchema = z.object({
  deviceName: z.string().min(1).max(100).optional(),
});
const packaged = createAuthSessionRouteHandlers({
  cookies: authHonoCookiePort,
  service: authHonoSessionService,
});
const token = (c: Context): string | undefined =>
  c.req.header('cookie')?.match(/session=([^;]+)/)?.[1]
  ?? c.req.header('authorization')?.replace('Bearer ', '');

export const sessionLifecycleHandlers: SessionRouteHandlers = {
  async current(c) {
    try {
      const sessionToken = token(c);
      if (!sessionToken) return c.json({ error: 'No session token provided' }, 401);
      const session = await validateSession(sessionToken);
      if (!session) return c.json({ error: 'Invalid or expired session' }, 401);
      const user = await findSessionUser(session.userId);
      return c.json({
        userId: session.userId,
        sessionId: session.sessionId,
        role: session.role,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
      });
    } catch (error) {
      logger.error({ err: error }, 'Error getting session info');
      return c.json({ error: 'Failed to get session info' }, 500);
    }
  },

  refresh: packaged.refreshSession!,

  async extensionToken(c) {
    try {
      const { deviceName } = extensionIssueSchema.parse(await c.req.json().catch(() => ({})));
      const sessionToken = token(c);
      if (!sessionToken) return c.json({ error: 'No session token provided' }, 401);
      const current = await validateSession(sessionToken);
      if (!current) return c.json({ error: 'Invalid or expired session' }, 401);
      const user = await findSessionUser(current.userId);
      const issued = await createSession(current.userId, current.role, {
        name: deviceName || 'Sentropic Extension',
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined,
        userAgent: c.req.header('user-agent') || undefined,
      });
      return c.json({
        success: true,
        user: {
          id: current.userId,
          email: user?.email ?? null,
          displayName: user?.displayName ?? null,
          role: current.role,
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
  },

  logout: packaged.logout!,

  async logoutAll(c) {
    try {
      const sessionToken = token(c);
      if (!sessionToken) return c.json({ error: 'No session token provided' }, 401);
      const session = await validateSession(sessionToken);
      if (!session) return c.json({ error: 'Invalid session' }, 401);
      await revokeAllSessions(session.userId);
      c.header('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
      logger.info({ userId: session.userId }, 'All sessions logged out');
      return c.json({ success: true, message: 'Logged out from all devices' });
    } catch (error) {
      logger.error({ err: error }, 'Error logging out all sessions');
      return c.json({ error: 'Failed to logout from all devices' }, 500);
    }
  },

  async list(c) {
    try {
      const sessionToken = token(c);
      if (!sessionToken) return c.json({ error: 'No session token provided' }, 401);
      const session = await validateSession(sessionToken);
      if (!session) return c.json({ error: 'Invalid session' }, 401);
      return c.json({ sessions: await listUserSessions(session.userId) });
    } catch (error) {
      logger.error({ err: error }, 'Error listing sessions');
      return c.json({ error: 'Failed to list sessions' }, 500);
    }
  },
};
