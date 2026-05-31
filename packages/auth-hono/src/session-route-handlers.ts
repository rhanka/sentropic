import type { Context } from 'hono';
import { z } from 'zod';

import type { AuthHonoCookiePort } from './ports.js';
import type { AuthHonoSessionService } from './session.js';
import type { AuthHonoRouteHandlers } from './router.js';

export interface CreateAuthSessionRouteHandlersOptions {
  cookies: AuthHonoCookiePort;
  service: AuthHonoSessionService;
}

const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export const createAuthSessionRouteHandlers = (
  options: CreateAuthSessionRouteHandlersOptions
): AuthHonoRouteHandlers => ({
  async refreshSession(c) {
    const parsed = await parseJson(c, refreshSessionSchema);

    if (!parsed.ok) {
      return errorResponse(c, 400, 'invalid_input', 'Invalid request data.', parsed.error.errors);
    }

    const tokens = await options.service.refreshSession(parsed.value.refreshToken);

    if (!tokens) {
      return errorResponse(c, 401, 'invalid_session', 'Invalid or expired refresh token.');
    }

    appendSetCookie(
      c,
      options.cookies.serializeSessionCookie({
        expiresAt: tokens.expiresAt,
        token: tokens.sessionToken,
      })
    );
    appendSetCookie(
      c,
      options.cookies.serializeRefreshCookie({
        expiresAt: tokens.expiresAt,
        token: tokens.refreshToken,
      })
    );

    return c.json({
      expiresAt: tokens.expiresAt.toISOString(),
      refreshToken: tokens.refreshToken,
      sessionToken: tokens.sessionToken,
      success: true,
    });
  },

  async logout(c) {
    const sessionToken = readSessionToken(c, options.cookies);

    if (!sessionToken) {
      return errorResponse(c, 401, 'authentication_required', 'No session token provided.');
    }

    const session = await options.service.validateSessionToken(sessionToken);

    if (!session) {
      return errorResponse(c, 401, 'invalid_session', 'Invalid session.');
    }

    await options.service.revokeSession(session.sessionRecord.id);

    appendSetCookie(c, options.cookies.serializeClearedSessionCookie());
    appendSetCookie(c, options.cookies.serializeClearedRefreshCookie());

    return c.json({ message: 'Logged out successfully', success: true });
  },
});

const parseJson = async <T extends z.ZodTypeAny>(
  c: Context,
  schema: T
): Promise<{ ok: true; value: z.infer<T> } | { error: z.ZodError; ok: false }> => {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return { error: parsed.error, ok: false };
  }

  return { ok: true, value: parsed.data };
};

const readSessionToken = (c: Context, cookies: AuthHonoCookiePort): string | null => {
  const cookieToken = cookies.readSessionToken(c.req.raw);

  if (cookieToken) {
    return cookieToken;
  }

  const authorization = c.req.header('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim() || null;
};

const appendSetCookie = (c: Context, value: string): void => {
  c.header('Set-Cookie', value, { append: true });
};

const errorResponse = (
  c: Context,
  status: 400 | 401,
  code: string,
  message: string,
  details?: z.ZodIssue[]
): Response =>
  c.json(
    {
      error: {
        code,
        ...(details ? { details } : {}),
        message,
      },
    },
    status
  );
