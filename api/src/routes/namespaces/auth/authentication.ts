import { createAuthWebAuthnAuthenticationRouteHandlers } from '@sentropic/auth-hono';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { users } from '../../../db/schema';
import { logger } from '../../../logger';
import { authHonoWebAuthnAuthenticationService } from '../../../services/auth/webauthn-adapter';
import { createSession } from '../../../services/session-manager';
import { ensureWorkspaceForUser } from '../../../services/workspace-service';

/**
 * WebAuthn Authentication Routes (`@sentropic/auth-hono`)
 *
 * POST /auth/login/options - Generate authentication options
 * POST /auth/login/verify  - Verify authentication response + finalize session
 */


export const loginHandlers = createAuthWebAuthnAuthenticationRouteHandlers({
  finalizeAuthentication: async ({ credentialId, request, userId }, c) => {
    const [user] = await db
      .select({
        accountStatus: users.accountStatus,
        approvalDueAt: users.approvalDueAt,
        displayName: users.displayName,
        email: users.email,
        emailVerified: users.emailVerified,
        id: users.id,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      logger.error({ userId }, 'User not found after authentication');
      return c.json(
        {
          error: {
            code: 'user_not_found',
            message: 'User not found.',
          },
        },
        404
      );
    }

    if (!user.emailVerified) {
      logger.warn({ userId }, 'Login blocked - email not verified');
      return c.json(
        {
          error: {
            code: 'email_verification_required',
            message:
              'Your email must be verified before you can log in. Please check your email for the verification link.',
          },
        },
        403
      );
    }

    // Do not auto-create a workspace on login (user may have lost their last workspace).
    await ensureWorkspaceForUser(user.id, { createIfMissing: false });

    const status = user.accountStatus ?? 'active';
    const due = user.approvalDueAt ?? null;
    const now = new Date();

    if (status === 'disabled_by_user' || status === 'disabled_by_admin') {
      return c.json(
        {
          error: {
            code: 'account_disabled',
            message: 'Account is disabled.',
          },
        },
        403
      );
    }

    let effectiveRole: string = user.role;
    if (status === 'approval_expired_readonly') effectiveRole = 'guest';
    if (status === 'pending_admin_approval' && due && now > due) effectiveRole = 'guest';

    const { expiresAt, refreshToken, sessionToken } = await createSession(user.id, effectiveRole, {
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      name: request.deviceName,
      userAgent: c.req.header('user-agent'),
    });

    const isProduction = process.env.NODE_ENV === 'production';
    const origin = c.req.header('origin');
    const cookieOptions = [
      `session=${sessionToken}`,
      'HttpOnly',
      isProduction ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${7 * 24 * 60 * 60}`,
    ];
    if (!isProduction && origin && origin.includes('localhost')) {
      cookieOptions.push('Domain=localhost');
    }
    c.header('Set-Cookie', cookieOptions.filter(Boolean).join('; '));

    logger.info({ credentialId, userId: user.id }, 'Authentication successful');

    return c.json({
      expiresAt: expiresAt.toISOString(),
      refreshToken,
      sessionToken,
      success: true,
      user: {
        displayName: user.displayName,
        email: user.email,
        id: user.id,
        role: user.role,
      },
    });
  },
  resolveAuthenticationOptions: async ({ email }) => {
    if (!email) {
      return { userId: undefined };
    }
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    return { userId: user?.id };
  },
  service: authHonoWebAuthnAuthenticationService,
});
