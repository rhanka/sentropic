import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import { 
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration 
} from '../../services/webauthn-registration';
import { createSession } from '../../services/session-manager';
import { verifyChallenge } from '../../services/challenge-manager';
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
    
    // Create user record (or get existing)
    // For now, generate temporary user ID
    const userId = crypto.randomUUID();
    
    // Generate registration options
    const options = await generateWebAuthnRegistrationOptions({
      userId,
      userName,
      userDisplayName,
    });
    
    // Store user info in temporary storage (could use Redis/DB)
    // For now, return userId with options for client to send back
    
    logger.info({ userName, userId }, 'Registration options generated');
    
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
    
    // Create session for user
    const { sessionToken, refreshToken, expiresAt } = await createSession(
      userId,
      'guest', // Default role for new users
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
    
    logger.info({ userId, credentialId: result.credentialId }, 'Registration successful');
    
    return c.json({
      success: true,
      user: {
        id: userId,
        userName,
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

