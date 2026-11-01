import { randomBytes } from 'crypto';
import { logger } from '../logger';
import { getWebAuthnConfig } from './webauthn-config';
import {
  createCmChallenge,
  findCmValidChallenge,
  consumeCmChallenge,
} from './identity/cm-proofs';
import { purgeCmExpiredProofs } from './identity/cm-proofs';
// purgeCmExpiredProofs covers all single-use proof kinds (challenges, magic links, email codes).

/**
 * Challenge Manager Service
 *
 * Manages WebAuthn challenge lifecycle:
 * - Generation with expiration
 * - Validation (not expired, not used)
 * - Marking as used to prevent replay attacks
 *
 * Persistence lives in the cluster-mesh identity custody store
 * (cm_identity.identity_single_use_proofs, kind 'webauthn_challenge').
 */

export type ChallengeType = 'registration' | 'authentication';

interface GenerateChallengeOptions {
  userId?: string;
  type: ChallengeType;
  challenge?: string; // Optional specific challenge to store (if not provided, will generate one)
  ttlSeconds?: number; // Time-to-live in seconds (default: 300)
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
 * @param ttlSeconds - Time-to-live in seconds (default: 300)
 * @returns Challenge record
 */
export async function generateChallenge(
  options: GenerateChallengeOptions
): Promise<Challenge> {
  const { userId, type, challenge: providedChallenge, ttlSeconds } = options;

  // Use provided challenge or generate a unique one
  const challenge = providedChallenge || (() => {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(16).toString('base64url');
    const uuid = crypto.randomUUID().replace(/-/g, '');
    return `${timestamp}-${random}-${uuid}`;
  })();

  const ttl = ttlSeconds || 300; // 5 minutes for both registration and authentication
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const webauthn = getWebAuthnConfig();

  const record = await createCmChallenge({
    challenge,
    userId: userId ?? null,
    type,
    expiresAt,
    now,
    rpId: webauthn.rpID,
    allowedOrigins: Array.isArray(webauthn.origin) ? webauthn.origin : [webauthn.origin],
    userVerification: 'required',
  });

  logger.debug({
    challengeId: record.id,
    type,
    userId: userId || 'anonymous',
    expiresAt,
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
    const record = await findCmValidChallenge(challenge, type, now);

    if (!record) {
      logger.warn({
        challenge: challenge ? challenge.substring(0, 10) + '...' : 'undefined',
        type,
      }, 'Challenge not found');
      return false;
    }

    // For authentication, verify user ID matches if provided
    if (type === 'authentication' && userId && record.userId !== userId) {
      logger.warn({
        challengeId: record.id,
        expectedUserId: userId,
        actualUserId: record.userId,
      }, 'Challenge user ID mismatch');
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ err: error, challenge: challenge ? challenge.substring(0, 10) + '...' : 'undefined' }, 'Error verifying challenge');
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
    const webauthn = getWebAuthnConfig();
    // Consume with a null binding: single-use semantics, no user binding required here.
    // Callers that bind a user (webauthn ceremonies) go through consumeCmChallenge directly.
    const consumed = await consumeCmChallenge(challenge, 'authentication', webauthn.rpID, null);
    if (!consumed) {
      // Fall back to registration purpose (registration ceremonies mark with that type)
      await consumeCmChallenge(challenge, 'registration', webauthn.rpID, null);
    }
    logger.debug({ challenge: challenge.substring(0, 10) + '...' }, 'Challenge marked as used');
  } catch (error) {
    logger.error({ err: error, challenge: challenge.substring(0, 10) + '...' }, 'Error marking challenge as used');
    throw error;
  }
}

/**
 * Purge all expired challenges (called by cold-start purge job)
 */
export async function purgeExpiredChallenges(): Promise<number> {
  try {
    const purged = await purgeCmExpiredProofs();
    if (purged > 0) {
      logger.info({ count: purged }, 'Purged expired WebAuthn challenges');
    }
    return purged;
  } catch (error) {
    logger.error({ err: error }, 'Error purging expired challenges');
    throw error;
  }
}
