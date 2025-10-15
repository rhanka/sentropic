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
    
    // Generate magic link
    const { token, expiresAt } = await generateMagicLink({ email });
    
    // Build magic link URL
    const baseUrl = env.AUTH_CALLBACK_BASE_URL || 'http://localhost:5173';
    const magicLinkUrl = `${baseUrl}/auth/magic-link/verify?token=${token}`;
    
    // Send email (placeholder implementation)
    await sendMagicLinkEmail(email, magicLinkUrl);
    
    logger.info({ email }, 'Magic link requested');
    
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
    
    // Create session for user
    const { sessionToken, refreshToken, expiresAt } = await createSession(
      result.userId,
      'guest', // Default role
      {
        name: 'Magic Link',
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      }
    );
    
    // Set session cookie
    c.header('Set-Cookie',
      `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    );
    
    logger.info({ userId: result.userId, email: result.email }, 'Magic link verified');
    
    return c.json({
      success: true,
      user: {
        id: result.userId,
        email: result.email,
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

