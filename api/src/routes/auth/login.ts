import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
} from '../../services/webauthn-authentication';
import { createSession } from '../../services/session-manager';
import { verifyChallenge } from '../../services/challenge-manager';
import { users } from '../../db/schema';
import { db } from '../../db/client';
import { eq } from 'drizzle-orm';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';

/**
 * WebAuthn Authentication Routes
 * 
 * POST /auth/login/options - Generate authentication options
 * POST /auth/login/verify - Verify authentication response
 */

export const loginRouter = new Hono();

// Request schemas
const loginOptionsSchema = z.object({
  userName: z.string().min(1).max(100).optional(), // Optional for discoverable credentials
});

const loginVerifySchema = z.object({
  credential: z.any(), // AuthenticationResponseJSON type
  deviceName: z.string().max(100).optional(),
});

/**
 * POST /auth/login/options
 * Generate WebAuthn authentication options
 */
loginRouter.post('/options', async (c) => {
  try {
    const body = await c.req.json();
    const { userName } = loginOptionsSchema.parse(body);
    
    let userId: string | undefined;
    
    // If userName provided, look up user ID
    if (userName) {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, userName)) // Assuming userName is email
        .limit(1);
      
      if (user) {
        userId = user.id;
      }
    }
    
    // Generate authentication options
    const options = await generateWebAuthnAuthenticationOptions({ userId });
    
    logger.info({ 
      userName: userName || 'discoverable',
      userId: userId || 'discoverable',
    }, 'Authentication options generated');
    
    return c.json({ options });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.errors }, 'Invalid login options request');
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error generating authentication options');
    return c.json({ error: 'Failed to generate authentication options' }, 500);
  }
});

/**
 * POST /auth/login/verify
 * Verify WebAuthn authentication response
 */
loginRouter.post('/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { credential, deviceName } = loginVerifySchema.parse(body);
    
    const credentialResponse = credential as AuthenticationResponseJSON;
    
    // Extract challenge from clientDataJSON
    const clientData = JSON.parse(
      Buffer.from(credentialResponse.response.clientDataJSON, 'base64url').toString()
    );
    const challenge = clientData.challenge;
    
    // Verify challenge is valid (userId is optional for authentication)
    const challengeValid = await verifyChallenge(challenge, undefined, 'authentication');
    if (!challengeValid) {
      logger.warn('Invalid or expired authentication challenge');
      return c.json({ error: 'Invalid or expired challenge' }, 400);
    }
    
    // Verify authentication
    const result = await verifyWebAuthnAuthentication({
      credential: credentialResponse,
      expectedChallenge: challenge,
    });
    
    if (!result.verified || !result.userId) {
      logger.warn('Authentication verification failed');
      return c.json({ error: 'Authentication verification failed' }, 401);
    }
    
    // Get user info
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, result.userId))
      .limit(1);
    
    if (!user) {
      logger.error({ userId: result.userId }, 'User not found after authentication');
      return c.json({ error: 'User not found' }, 404);
    }
    
    // Create session for user
    const { sessionToken, refreshToken, expiresAt } = await createSession(
      user.id,
      user.role,
      {
        name: deviceName,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      }
    );
    
    // Set session cookie
    c.header('Set-Cookie',
      `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    );
    
    logger.info({ 
      userId: user.id,
      credentialId: result.credentialId,
    }, 'Authentication successful');
    
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.errors }, 'Invalid login verify request');
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error verifying authentication');
    return c.json({ error: 'Failed to verify authentication' }, 500);
  }
});

