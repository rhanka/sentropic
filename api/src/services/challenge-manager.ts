import { db } from '../db/client';
import { webauthnChallenges } from '../db/schema';
import { eq, and, lt } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { logger } from '../logger';

/**
 * Challenge Manager Service
 * 
 * Manages WebAuthn challenge lifecycle:
 * - Generation with expiration
 * - Validation (not expired, not used)
 * - Marking as used to prevent replay attacks
 */

export type ChallengeType = 'registration' | 'authentication';

interface GenerateChallengeOptions {
  userId?: string;
  type: ChallengeType;
  challenge?: string; // Optional specific challenge to store (if not provided, will generate one)
  ttlSeconds?: number; // Time-to-live in seconds (default: 60s for registration, 300s for auth)
}

interface Challenge {
  id: string;
  challenge: string;
  userId: string | null;
  type: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

/**
 * Generate a cryptographically secure random challenge
 * 
 * @param userId - Optional user ID for authentication challenges
 * @param type - Challenge type: 'registration' or 'authentication'
 * @param ttlSeconds - Time-to-live in seconds (default: 60 for registration, 300 for authentication)
 * @returns Challenge string (base64url-encoded) and database record
 */
export async function generateChallenge(
  options: GenerateChallengeOptions
): Promise<Challenge> {
  const { userId, type, challenge: providedChallenge, ttlSeconds } = options;
  
  // Use provided challenge or generate a new one
  const challenge = providedChallenge || randomBytes(32).toString('base64url');
  
  // Set TTL based on type if not specified
  const defaultTTL = type === 'registration' ? 300 : 300; // 5 minutes for both registration and authentication
  const ttl = ttlSeconds || defaultTTL;
  
  // Calculate expiration time
  const expiresAt = new Date(Date.now() + ttl * 1000);
  
  // Store challenge in database
  const [record] = await db
    .insert(webauthnChallenges)
    .values({
      id: crypto.randomUUID(),
      challenge,
      userId: userId || null,
      type,
      expiresAt,
      used: false,
      createdAt: new Date(),
    })
    .returning();
  
  logger.debug({ 
    challengeId: record.id, 
    type, 
    userId: userId || 'anonymous',
    expiresAt 
  }, 'WebAuthn challenge generated');
  
  return record;
}

/**
 * Verify a challenge is valid (exists, not expired, not used)
 * 
 * @param challenge - Challenge string to verify
 * @param userId - Optional user ID to verify ownership (for authentication)
 * @param type - Challenge type to verify
 * @returns true if valid, false otherwise
 */
export async function verifyChallenge(
  challenge: string,
  userId: string | undefined,
  type: ChallengeType
): Promise<boolean> {
  try {
    const now = new Date();
    
    // Build query conditions
    const conditions = [
      eq(webauthnChallenges.challenge, challenge),
      eq(webauthnChallenges.type, type),
      eq(webauthnChallenges.used, false),
    ];
    
    // Find challenge
    const [record] = await db
      .select()
      .from(webauthnChallenges)
      .where(and(...conditions))
      .limit(1);
    
    if (!record) {
      // Let's see what challenges exist for debugging
      const allChallenges = await db
        .select({ id: webauthnChallenges.id, challenge: webauthnChallenges.challenge, type: webauthnChallenges.type, used: webauthnChallenges.used, expiresAt: webauthnChallenges.expiresAt })
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.type, type))
        .limit(5);
      
      logger.warn({ 
        challenge: challenge.substring(0, 10) + '...', 
        type,
        existingChallenges: allChallenges.map(c => ({
          id: c.id.substring(0, 8) + '...',
          challenge: c.challenge.substring(0, 10) + '...',
          used: c.used,
          expired: c.expiresAt < now
        }))
      }, 'Challenge not found');
      return false;
    }
    
    // Check if expired
    if (record.expiresAt < now) {
      logger.warn({ 
        challengeId: record.id, 
        expiresAt: record.expiresAt,
        type 
      }, 'Challenge expired');
      return false;
    }
    
    // For authentication, verify user ID matches if provided
    if (type === 'authentication' && userId && record.userId !== userId) {
      logger.warn({ 
        challengeId: record.id,
        expectedUserId: userId,
        actualUserId: record.userId 
      }, 'Challenge user ID mismatch');
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error({ err: error, challenge: challenge.substring(0, 10) + '...' }, 'Error verifying challenge');
    return false;
  }
}

/**
 * Mark a challenge as used to prevent replay attacks
 * 
 * @param challenge - Challenge string to mark as used
 */
export async function markChallengeUsed(challenge: string): Promise<void> {
  try {
    await db
      .update(webauthnChallenges)
      .set({ used: true })
      .where(eq(webauthnChallenges.challenge, challenge));
    
    logger.debug({ challenge: challenge.substring(0, 10) + '...' }, 'Challenge marked as used');
  } catch (error) {
    logger.error({ err: error, challenge: challenge.substring(0, 10) + '...' }, 'Error marking challenge as used');
    throw error;
  }
}

/**
 * Purge all expired challenges (called by cold-start purge job)
 * This is also available as a standalone function if needed
 */
export async function purgeExpiredChallenges(): Promise<number> {
  try {
    const now = new Date();
    const deleted = await db
      .delete(webauthnChallenges)
      .where(lt(webauthnChallenges.expiresAt, now))
      .returning({ id: webauthnChallenges.id });
    
    if (deleted.length > 0) {
      logger.info({ count: deleted.length }, 'Purged expired WebAuthn challenges');
    }
    
    return deleted.length;
  } catch (error) {
    logger.error({ err: error }, 'Error purging expired challenges');
    throw error;
  }
}

