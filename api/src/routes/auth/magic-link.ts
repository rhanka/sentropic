import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  generateMagicLink,
  verifyMagicLink,
  sendMagicLinkEmail,
} from '../../services/magic-link';
import { createSession } from '../../services/session-manager';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { users, webauthnCredentials } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * Magic Link Authentication Routes
 * 
 * POST /auth/magic-link/request - Request magic link
 * POST /auth/magic-link/verify - Verify magic link token
 */

export const magicLinkRouter = new Hono();

// Request schemas
const requestMagicLinkSchema = z.object({
  email: z.string().email(),
});

const verifyMagicLinkSchema = z.object({
  token: z.string(),
});

/**
 * POST /auth/magic-link/request
 * Request a magic link to be sent to email
 */
magicLinkRouter.post('/request', async (c) => {
  try {
    const body = await c.req.json();
    const { email } = requestMagicLinkSchema.parse(body);
    
    const normalizedEmail = email.trim().toLowerCase();
    
    // Generate magic link
    const { token } = await generateMagicLink({ email: normalizedEmail });
    
    // Build magic link URL
    const baseUrl = env.AUTH_CALLBACK_BASE_URL || 'http://localhost:5173';
    const magicLinkUrl = `${baseUrl}/auth/magic-link/verify?token=${token}`;
    
    // Send email (placeholder implementation)
    await sendMagicLinkEmail(normalizedEmail, magicLinkUrl);
    
    logger.info({ email: normalizedEmail }, 'Magic link requested');
    
    // Don't expose token or expiration to client (security)
    return c.json({
      success: true,
      message: 'Magic link sent to your email',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error requesting magic link');
    return c.json({ error: 'Failed to send magic link' }, 500);
  }
});

/**
 * POST /auth/magic-link/verify
 * Verify magic link token and create session
 */
magicLinkRouter.post('/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { token } = verifyMagicLinkSchema.parse(body);
    
    // Verify magic link
    const result = await verifyMagicLink(token);
    
    if (!result.valid || !result.userId || !result.email) {
      logger.warn({ token: token.substring(0, 10) + '...' }, 'Invalid magic link');
      return c.json({ error: 'Invalid or expired magic link' }, 400);
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.id, result.userId))
      .limit(1);

    if (!user) {
      logger.error({ userId: result.userId }, 'User not found during magic link verification');
      return c.json({ error: 'User not found' }, 500);
    }
    
    // Note: verifyMagicLink already marks emailVerified: true
    // Now we need to check if there's a new device waiting to be activated
    // Get the most recently created device for this user
    const [newestDevice] = await db
      .select({
        id: webauthnCredentials.id,
        credentialId: webauthnCredentials.credentialId,
        deviceName: webauthnCredentials.deviceName,
        createdAt: webauthnCredentials.createdAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, result.userId))
      .orderBy(desc(webauthnCredentials.createdAt))
      .limit(1);
    
    // Check if user has existing devices
    const allDevices = await db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, result.userId));
    
    const hasDevices = allDevices.length > 0;
    
    // If there's a device (new or existing), create session and activate
    // The device(s) are now usable because emailVerified is true
    if (hasDevices) {
      logger.info({ 
        userId: result.userId, 
        email: result.email,
        devicesCount: allDevices.length,
        newestDeviceId: newestDevice?.id,
      }, 'Magic link verified - device(s) activated, creating session');
      
      // Create session
      const { sessionToken, refreshToken, expiresAt } = await createSession(
        user.id,
        user.role,
        {
          name: 'Magic Link - Device Activation',
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
    }
    
    // No devices: edge case - redirect to register
    logger.info({ 
      userId: result.userId, 
      email: result.email 
    }, 'Magic link verified - no devices, redirecting to registration');
    
    // Create temporary session to allow device registration
    const { sessionToken, refreshToken, expiresAt } = await createSession(
      user.id,
      user.role,
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
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error verifying magic link');
    return c.json({ error: 'Failed to verify magic link' }, 500);
  }
});

