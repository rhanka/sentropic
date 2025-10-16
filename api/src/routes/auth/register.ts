import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import { 
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration 
} from '../../services/webauthn-registration';
import { createSession } from '../../services/session-manager';
import { verifyChallenge } from '../../services/challenge-manager';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { env } from '../../config/env';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';

/**
 * WebAuthn Registration Routes
 * 
 * POST /auth/register/options - Generate registration options
 * POST /auth/register/verify - Verify registration response
 */

export const registerRouter = new Hono();

// Request schemas
const registerOptionsSchema = z.object({
  userName: z.string().min(1).max(100),
  userDisplayName: z.string().min(1).max(100),
  email: z.string().email().optional(),
});

const registerVerifySchema = z.object({
  userName: z.string().min(1).max(100),
  credential: z.any(), // RegistrationResponseJSON type
  deviceName: z.string().max(100).optional(),
});

/**
 * POST /auth/register/options
 * Generate WebAuthn registration options
 */
registerRouter.post('/options', async (c) => {
  try {
    const body = await c.req.json();
    const { userName, userDisplayName, email } = registerOptionsSchema.parse(body);
    
    // Check if user already exists
    let existingUser;
    if (email) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      existingUser = user;
    }
    
    // If user doesn't exist by email, check by userName (for backward compatibility)
    if (!existingUser) {
      const [user] = await db.select().from(users).where(eq(users.displayName, userName)).limit(1);
      existingUser = user;
    }
    
    let userId: string;
    let userRole: 'admin_app' | 'admin_org' | 'editor' | 'guest';
    
    if (existingUser) {
      // Use existing user
      userId = existingUser.id;
      userRole = existingUser.role as 'admin_app' | 'admin_org' | 'editor' | 'guest';
      logger.info({ userId, email: existingUser.email }, 'Using existing user for registration');
    } else {
      // Determine user role for new user
      userRole = 'guest';
      if (email && env.ADMIN_EMAIL && email === env.ADMIN_EMAIL) {
        const existingAdmins = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, 'admin_app'))
          .limit(1);
        
        if (existingAdmins.length === 0) {
          userRole = 'admin_app';
          logger.info({ email, userName }, 'Admin user registration detected');
        } else {
          logger.info({ email }, 'Admin email used but admin already exists, creating guest');
        }
      }
      
      // Create new user record
      userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        email: email || null,
        displayName: userDisplayName,
        role: userRole,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    
    // Generate registration options
    const options = await generateWebAuthnRegistrationOptions({
      userId,
      userName,
      userDisplayName,
    });
    
    logger.info({ 
      userName, 
      userId, 
      role: userRole,
      email 
    }, 'Registration options generated');
    
    return c.json({
      options,
      userId, // Client must send this back with verification
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.errors }, 'Invalid registration options request');
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error generating registration options');
    return c.json({ error: 'Failed to generate registration options' }, 500);
  }
});

/**
 * POST /auth/register/verify
 * Verify WebAuthn registration response
 */
registerRouter.post('/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { userName, credential, deviceName } = registerVerifySchema.parse(body);
    
    // Get userId from credential response or request
    const userId = (body as any).userId;
    if (!userId) {
      return c.json({ error: 'Missing userId' }, 400);
    }
    
    const credentialResponse = credential as RegistrationResponseJSON;
    const expectedChallenge = credentialResponse.response.clientDataJSON;
    
    // Extract challenge from clientDataJSON
    const clientData = JSON.parse(
      Buffer.from(credentialResponse.response.clientDataJSON, 'base64url').toString()
    );
    const challenge = clientData.challenge;
    
    logger.debug({ 
      receivedChallenge: challenge.substring(0, 10) + '...',
      userId 
    }, 'Extracted challenge from clientDataJSON');
    
    // Verify challenge is valid
    const challengeValid = await verifyChallenge(challenge, userId, 'registration');
    if (!challengeValid) {
      logger.warn({ userId }, 'Invalid or expired registration challenge');
      return c.json({ error: 'Invalid or expired challenge' }, 400);
    }
    
    // Verify registration
    const result = await verifyWebAuthnRegistration({
      userId,
      credential: credentialResponse,
      expectedChallenge: challenge,
      deviceName,
    });
    
    if (!result.verified) {
      logger.warn({ userId }, 'Registration verification failed');
      return c.json({ error: 'Registration verification failed' }, 400);
    }
    
    // Get user role from database
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    if (!user) {
      logger.error({ userId }, 'User not found during registration verification');
      return c.json({ error: 'User not found' }, 500);
    }
    
    // Create session for user
    const { sessionToken, refreshToken, expiresAt } = await createSession(
      userId,
      user.role,
      {
        name: deviceName,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      }
    );
    
    // Set session cookie (Secure only in production)
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = [
      `session=${sessionToken}`,
      'HttpOnly',
      isProduction ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      'Domain=localhost', // Allow sharing between localhost ports
      `Max-Age=${7 * 24 * 60 * 60}`
    ].filter(Boolean).join('; ');
    
    c.header('Set-Cookie', cookieOptions);
    
    logger.info({ 
      userId, 
      credentialId: result.credentialId,
      role: user.role 
    }, 'Registration successful');
    
    return c.json({
      success: true,
      user: {
        id: userId,
        userName,
        role: user.role,
      },
      sessionToken,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.errors }, 'Invalid registration verify request');
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error verifying registration');
    return c.json({ error: 'Failed to verify registration' }, 500);
  }
});

