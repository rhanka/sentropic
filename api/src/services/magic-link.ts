import { db } from '../db/client';
import { magicLinks, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { logger } from '../logger';

/**
 * Magic Link Service
 * 
 * Fallback authentication method using email magic links:
 * - Generate secure magic link tokens
 * - Send magic link emails
 * - Verify magic link tokens
 * - Create or find user accounts
 */

interface GenerateMagicLinkParams {
  email: string;
  userId?: string; // Optional for existing users
}

interface MagicLinkResult {
  token: string;
  expiresAt: Date;
}

interface VerifyMagicLinkResult {
  valid: boolean;
  userId?: string;
  email?: string;
}

const MAGIC_LINK_TTL = 15 * 60; // 15 minutes in seconds

/**
 * Hash a token for storage (SHA-256)
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a magic link token
 * 
 * @param params - Email and optional user ID
 * @returns Magic link token and expiration
 */
export async function generateMagicLink(
  params: GenerateMagicLinkParams
): Promise<MagicLinkResult> {
  const { email, userId } = params;
  
  // Generate secure random token (32 bytes)
  const tokenBuffer = randomBytes(32);
  const token = tokenBuffer.toString('base64url');
  const tokenHash = hashToken(token);
  
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL * 1000);
  
  // Store magic link in database
  await db.insert(magicLinks).values({
    id: crypto.randomUUID(),
    tokenHash,
    email,
    userId: userId || null,
    expiresAt,
    used: false,
    createdAt: new Date(),
  });
  
  logger.info({
    email,
    userId: userId || 'new_user',
    expiresAt,
  }, 'Magic link generated');
  
  return { token, expiresAt };
}

/**
 * Verify a magic link token
 * 
 * @param token - Magic link token to verify
 * @returns Verification result with user ID and email if valid
 */
export async function verifyMagicLink(
  token: string
): Promise<VerifyMagicLinkResult> {
  try {
    const tokenHash = hashToken(token);
    const now = new Date();
    
    // Find magic link
    const [link] = await db
      .select()
      .from(magicLinks)
      .where(
        and(
          eq(magicLinks.tokenHash, tokenHash),
          eq(magicLinks.used, false)
        )
      )
      .limit(1);
    
    if (!link) {
      logger.warn('Magic link not found or already used');
      return { valid: false };
    }
    
    // Check if expired
    if (link.expiresAt < now) {
      logger.warn({ 
        linkId: link.id,
        expiresAt: link.expiresAt 
      }, 'Magic link expired');
      return { valid: false };
    }
    
    // Mark as used
    await db
      .update(magicLinks)
      .set({ used: true })
      .where(eq(magicLinks.id, link.id));
    
    // If user ID exists, return it
    if (link.userId) {
      logger.info({
        userId: link.userId,
        email: link.email,
      }, 'Magic link verified for existing user');
      
      return {
        valid: true,
        userId: link.userId,
        email: link.email,
      };
    }
    
    // Create new user if doesn't exist
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, link.email))
      .limit(1);
    
    if (existingUser) {
      logger.info({
        userId: existingUser.id,
        email: link.email,
      }, 'Magic link verified, user found by email');
      
      return {
        valid: true,
        userId: existingUser.id,
        email: link.email,
      };
    }
    
    // Create new user
    const [newUser] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: link.email,
        displayName: link.email.split('@')[0], // Use email prefix as display name
        role: 'guest', // Default role
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    
    logger.info({
      userId: newUser.id,
      email: link.email,
    }, 'Magic link verified, new user created');
    
    return {
      valid: true,
      userId: newUser.id,
      email: link.email,
    };
  } catch (error) {
    logger.error({ err: error }, 'Error verifying magic link');
    return { valid: false };
  }
}

/**
 * Send magic link email (placeholder - to be implemented with email service)
 * 
 * @param email - Recipient email
 * @param magicLink - Full magic link URL
 */
export async function sendMagicLinkEmail(
  email: string,
  magicLink: string
): Promise<void> {
  // TODO: Integrate with email service (SendGrid, Resend, etc.)
  // For now, just log the magic link
  logger.info({
    email,
    magicLink,
  }, '[PLACEHOLDER] Magic link email would be sent');
  
  // In production, implement:
  // - Email template with branding
  // - Rate limiting per email
  // - Email service integration
  // Example:
  // await emailService.send({
  //   to: email,
  //   subject: 'Your Top AI Ideas login link',
  //   html: `<p>Click here to login: <a href="${magicLink}">${magicLink}</a></p>`,
  // });
}

