import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import { 
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
} from '../../services/webauthn-registration';
import { createSession } from '../../services/session-manager';
import { verifyChallenge } from '../../services/challenge-manager';
import { db } from '../../db/client';
import { users, magicLinks, webauthnCredentials } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { env } from '../../config/env';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';
import { deriveDisplayNameFromEmail } from '../../utils/display-name';
import { verifyValidationToken } from '../../services/email-verification';

/**
 * WebAuthn Registration Routes
 * 
 * POST /auth/register/options - Generate registration options
 * POST /auth/register/verify - Verify registration response
 */

export const registerRouter = new Hono();

// Request schemas
const registerOptionsSchema = z.object({
  email: z.string().email(),
  verificationToken: z.string().optional(), // Token from email code verification
});

const registerVerifySchema = z.object({
  email: z.string().email(),
  verificationToken: z.string(), // Token from email code verification (required)
  userId: z.string().uuid(), // Temporary userId from options (used for challenge verification)
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
    const { email, verificationToken } = registerOptionsSchema.parse(body);

    const normalizedEmail = email.trim().toLowerCase();
    
    // If verificationToken provided, verify it
    if (verificationToken) {
      const tokenValidation = await verifyValidationToken(verificationToken);
      if (!tokenValidation.valid || tokenValidation.email !== normalizedEmail) {
        logger.warn({ email: normalizedEmail }, 'Invalid verification token');
        return c.json({ 
          error: 'Invalid verification token',
          message: 'Le token de vérification est invalide ou expiré'
        }, 403);
      }
      logger.info({ email: normalizedEmail }, 'Verification token validated for registration');
    }
    const emailLocalPart = normalizedEmail.split('@')[0] ?? normalizedEmail;
    const defaultDisplayName = deriveDisplayNameFromEmail(normalizedEmail);
    
    // Check if user already exists
    let existingUser;
    const [emailUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    existingUser = emailUser;

    // Backward compatibility: fallback on display name lookup if email missing
    if (!existingUser) {
      const [displayNameUser] = await db
        .select()
        .from(users)
        .where(eq(users.displayName, normalizedEmail))
        .limit(1);
      existingUser = displayNameUser;
    }

    if (!existingUser) {
      const [legacyDisplayUser] = await db
        .select()
        .from(users)
        .where(eq(users.displayName, emailLocalPart))
        .limit(1);
      existingUser = legacyDisplayUser;
    }
    
    let userId: string;
    let userRole: 'admin_app' | 'admin_org' | 'editor' | 'guest';
    let isNewUser = false;
    
    if (existingUser) {
      // Use existing user
      userId = existingUser.id;
      userRole = existingUser.role as 'admin_app' | 'admin_org' | 'editor' | 'guest';
      
      // Update email if missing
      if (!existingUser.email && normalizedEmail) {
        await db
          .update(users)
          .set({
            email: normalizedEmail,
            displayName: existingUser.displayName ?? defaultDisplayName,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id));
      }
      
      logger.info({ userId, email: existingUser.email ?? normalizedEmail }, 'Using existing user for registration');
      
      // Check if email has been verified (emailVerified flag in users table)
      if (!existingUser.emailVerified) {
        logger.warn({ email: normalizedEmail, userId }, 'Email not verified - registration blocked');
        return c.json({ 
          error: 'Email verification required', 
          message: 'You must verify your email via magic link before registering a WebAuthn credential' 
        }, 403);
      }
    } else {
      // Determine user role for new user
      userRole = 'guest';
      if (env.ADMIN_EMAIL && normalizedEmail === env.ADMIN_EMAIL.toLowerCase()) {
        const existingAdmins = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, 'admin_app'))
          .limit(1);
        
        if (existingAdmins.length === 0) {
          userRole = 'admin_app';
          logger.info({ email: normalizedEmail }, 'Admin user registration detected');
        } else {
          logger.info({ email: normalizedEmail }, 'Admin email used but admin already exists, creating guest');
        }
      }
      
      // For new users, email verification is mandatory before WebAuthn registration
      // Must provide valid verificationToken
      if (!verificationToken) {
        logger.warn({ email: normalizedEmail }, 'Email not verified - verification token required');
        return c.json({ 
          error: 'Email verification required', 
          message: 'Vous devez vérifier votre email avec un code avant d\'enregistrer un device' 
        }, 403);
      }
      
      // Token already verified above, create user ID placeholder (will be used in verify)
      // This userId will be used for the challenge, then reused in verify to create the user
      userId = crypto.randomUUID();
      isNewUser = true;
      logger.info({ email: normalizedEmail, userId }, 'New user registration - temporary userId created for challenge');
    }
    
    // Generate registration options
    // For new users, pass null as userId to challenge (user doesn't exist yet)
    // The userId will be set when the user is created in /verify
    const options = await generateWebAuthnRegistrationOptions({
      userId: isNewUser ? undefined : userId, // undefined for new users (will become null in challenge)
      userName: normalizedEmail,
      userDisplayName: defaultDisplayName,
    });
    
    logger.info({ 
      email: normalizedEmail,
      userId, 
      role: userRole,
    }, 'Registration options generated');
    
    return c.json({
      options,
      userId, // Client must send this back with verification (will be used to verify challenge)
      challengeId: options.challengeId, // Include challengeId for testing
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
    const { email, verificationToken, userId: tempUserId, credential, deviceName } = registerVerifySchema.parse(body);
    
    const normalizedEmail = email.trim().toLowerCase();
    
    // Verify validation token
    const tokenValidation = await verifyValidationToken(verificationToken);
    if (!tokenValidation.valid || tokenValidation.email !== normalizedEmail) {
      logger.warn({ email: normalizedEmail }, 'Invalid verification token');
      return c.json({ 
        error: 'Invalid verification token',
        message: 'Le token de vérification est invalide ou expiré'
      }, 403);
    }
    
    // Validate credential structure
    if (!credential || !credential.response) {
      logger.warn({ email: normalizedEmail }, 'Invalid credential structure');
      return c.json({ 
        error: 'Invalid credential',
        message: 'La structure de la credential est invalide'
      }, 400);
    }
    
    const credentialResponse = credential as RegistrationResponseJSON;
    
    // Extract challenge and credential ID from clientDataJSON
    if (!credentialResponse.response.clientDataJSON) {
      logger.warn({ email: normalizedEmail }, 'Missing clientDataJSON in credential');
      return c.json({ 
        error: 'Invalid credential',
        message: 'La credential ne contient pas les données nécessaires'
      }, 400);
    }
    
    let clientData;
    try {
      clientData = JSON.parse(
        Buffer.from(credentialResponse.response.clientDataJSON, 'base64url').toString()
      );
    } catch (error) {
      logger.warn({ email: normalizedEmail, err: error }, 'Failed to parse clientDataJSON');
      return c.json({ 
        error: 'Invalid credential',
        message: 'Les données de la credential sont invalides'
      }, 400);
    }
    
    const challenge = clientData.challenge;
    
    // Extract credential ID before verification to check if it already exists
    const credentialIdArray = credentialResponse.id instanceof Uint8Array 
      ? credentialResponse.id 
      : new Uint8Array(Object.values(credentialResponse.id));
    const credentialIdBase64 = Buffer.from(credentialIdArray).toString('base64url');
    
    logger.debug({ 
      receivedChallenge: challenge.substring(0, 10) + '...',
      credentialId: credentialIdBase64.substring(0, 10) + '...',
      email: normalizedEmail,
      tempUserId,
    }, 'Extracted challenge and credential ID from clientDataJSON');
    
    // Check if this device is already registered
    const [existingCredential] = await db
      .select({ id: webauthnCredentials.id, userId: webauthnCredentials.userId })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialIdBase64))
      .limit(1);
    
    if (existingCredential) {
      logger.warn({ credentialId: credentialIdBase64.substring(0, 10) + '...' }, 'Device already registered');
      return c.json({ 
        error: 'Device already registered',
        message: 'Ce device est déjà enregistré, utilisez-le pour vous connecter'
      }, 400);
    }
    
    // Verify challenge is valid (using tempUserId from options)
    const challengeValid = await verifyChallenge(challenge, tempUserId, 'registration');
    if (!challengeValid) {
      logger.warn({ tempUserId }, 'Invalid or expired registration challenge');
      return c.json({ error: 'Invalid or expired challenge' }, 400);
    }
    
    // Check if user exists or create new one
    let [user] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        emailVerified: users.emailVerified,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    
    let userId: string;
    let userRole: 'admin_app' | 'admin_org' | 'editor' | 'guest';
    
    if (user) {
      userId = user.id;
      userRole = user.role as 'admin_app' | 'admin_org' | 'editor' | 'guest';
      
      // Verify challenge was for the correct user (or update if tempUserId matches)
      if (userId !== tempUserId) {
        logger.warn({ userId, tempUserId }, 'UserId mismatch between challenge and existing user');
        return c.json({ 
          error: 'Invalid challenge',
          message: 'Le challenge ne correspond pas à l\'utilisateur'
        }, 400);
      }
      
      // Update email verified status if not already verified
      if (!user.emailVerified) {
        await db
          .update(users)
          .set({ 
            emailVerified: true,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      }
    } else {
      // Create new user with email verified, using tempUserId from options
      userId = tempUserId; // Reuse the userId from options/challenge
      userRole = 'guest';
      
      if (env.ADMIN_EMAIL && normalizedEmail === env.ADMIN_EMAIL.toLowerCase()) {
        const existingAdmins = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, 'admin_app'))
          .limit(1);
        
        if (existingAdmins.length === 0) {
          userRole = 'admin_app';
        }
      }
      
      const defaultDisplayName = deriveDisplayNameFromEmail(normalizedEmail);
      await db.insert(users).values({
        id: userId,
        email: normalizedEmail,
        displayName: defaultDisplayName,
        role: userRole,
        emailVerified: true, // Email verified via code
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      
      logger.info({ userId, email: normalizedEmail }, 'New user created with verified email');
    }
    
    // Verify registration and create device
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
    
    // Check if user has other existing devices
    const otherDevices = await db
      .select({
        id: webauthnCredentials.id,
        deviceName: webauthnCredentials.deviceName,
        createdAt: webauthnCredentials.createdAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId))
      .orderBy(desc(webauthnCredentials.createdAt));
    
    const isFirstDevice = otherDevices.length === 0;
    
    // Create session (always for new registration flow)
    const session = await createSession(
      userId,
      userRole,
      {
        name: deviceName,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
        userAgent: c.req.header('user-agent'),
      }
    );
    
    // Set session cookie
    const origin = c.req.header('origin') || '';
    let domainAttr = '';
    try {
      const { hostname } = new URL(origin);
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        domainAttr = 'Domain=localhost';
      }
    } catch {}

    const isProduction = process.env.NODE_ENV === 'production';
    const cookieParts = [
      `session=${session.sessionToken}`,
      'HttpOnly',
      isProduction ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      domainAttr,
      `Max-Age=${7 * 24 * 60 * 60}`
    ].filter(Boolean);

    c.header('Set-Cookie', cookieParts.join('; '));
    
    // Get full user info
    if (!user) {
      [user] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          emailVerified: users.emailVerified,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    }
    
    logger.info({ 
      userId, 
      credentialId: result.credentialId?.substring(0, 10) + '...',
      role: userRole,
      isFirstDevice,
      emailVerified: true,
    }, 'Registration successful');
    
    return c.json({
      success: true,
      user: user ? {
        id: user.id,
        email: user.email,
        displayName: user.displayName || null,
        role: user.role,
      } : undefined,
      sessionToken: session.sessionToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      isFirstDevice,
      otherDevices: otherDevices.length > 0 ? otherDevices.map(d => ({
        id: d.id,
        deviceName: d.deviceName,
        createdAt: d.createdAt.toISOString(),
      })) : undefined,
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


