import type { AuthHonoRouteHandlers } from '@sentropic/auth-hono';
import { z } from 'zod';
import { logger } from '../../../logger';
import { verifyMagicLink } from '../../../services/magic-link';
import { cmMagicLinkHandlers } from './cm-magic-link';
import { createSession } from '../../../services/session-manager';
import { findCmUserById } from '../../../services/identity/cm-users';
import { listCmCredentialsForUser } from '../../../services/identity/cm-proofs';
import { ensureWorkspaceForUser } from '../../../services/workspace-service';

/**
 * Magic Link Authentication Routes
 * 
 * POST /auth/magic-link/request - Request magic link
 * POST /auth/magic-link/verify - Verify magic link token
 */


// Request schemas
const verifyMagicLinkSchema = z.object({
  token: z.string(),
});

/**
 * POST /auth/magic-link/verify
 * Verify magic link token and create session
 */
export const magicLinkHandlers: AuthHonoRouteHandlers = {
  ...cmMagicLinkHandlers,
  async verifyMagicLink(c) {
  try {
    const body = await c.req.json();
    const { token } = verifyMagicLinkSchema.parse(body);
    
    // Verify magic link
    const result = await verifyMagicLink(token);
    
    if (!result.valid || !result.userId || !result.email) {
      logger.warn({ token: token.substring(0, 10) + '...' }, 'Invalid magic link');
      return c.json({ error: 'Invalid or expired magic link' }, 400);
    }

    const user = await findCmUserById(result.userId);

    if (!user) {
      logger.error({ userId: result.userId }, 'User not found during magic link verification');
      return c.json({ error: 'User not found' }, 500);
    }

    await ensureWorkspaceForUser(user.id, { createIfMissing: false });

    // Compute effective role (approval expired => guest read-only)
    const status = user.accountStatus ?? 'active';
    const due = user.approvalDueAt ?? null;
    const now = new Date();

    if (status === 'disabled_by_user' || status === 'disabled_by_admin') {
      return c.json({ error: 'Account disabled' }, 403);
    }

    let effectiveRole: string = user.role;
    if (status === 'approval_expired_readonly') effectiveRole = 'guest';
    if (status === 'pending_admin_approval' && due && now > due) effectiveRole = 'guest';
    
    // Note: verifyMagicLink already marks emailVerified: true
    // Now we need to check if there's a new device waiting to be activated
    // Get the most recently created device for this user
    const allDevices = await listCmCredentialsForUser(result.userId);
    
    // No devices: edge case - redirect to register
    logger.info({ 
      userId: result.userId, 
      email: result.email 
    }, 'Magic link verified - no devices, redirecting to registration');
    
    // Create temporary session to allow device registration
    const { sessionToken, refreshToken, expiresAt } = await createSession(
      user.id,
      effectiveRole,
      {
        name: 'Magic Link - Device Registration',
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      }
    );
    
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
    
    return c.json({
      success: true,
      requiresDeviceRegistration: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      sessionToken,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }
    
    logger.error({ err: error }, 'Error verifying magic link');
    return c.json({ error: 'Failed to verify magic link' }, 500);
  }
  },
};
