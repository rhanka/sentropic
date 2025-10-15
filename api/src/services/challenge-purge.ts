import { db } from '../db/client';
import { webauthnChallenges, magicLinks } from '../db/schema';
import { lt } from 'drizzle-orm';
import { logger } from '../logger';

/**
 * Purge expired challenges and magic links from database
 * 
 * Called at API startup (cold start) to clean up stale data.
 * Prevents database bloat from accumulating expired authentication tokens.
 */
export async function purgeExpiredAuthData(): Promise<void> {
  try {
    const now = new Date();
    
    // Delete expired WebAuthn challenges
    const deletedChallenges = await db
      .delete(webauthnChallenges)
      .where(lt(webauthnChallenges.expiresAt, now))
      .returning({ id: webauthnChallenges.id });
    
    // Delete expired magic links
    const deletedMagicLinks = await db
      .delete(magicLinks)
      .where(lt(magicLinks.expiresAt, now))
      .returning({ id: magicLinks.id });
    
    if (deletedChallenges.length > 0 || deletedMagicLinks.length > 0) {
      logger.info({
        deletedChallenges: deletedChallenges.length,
        deletedMagicLinks: deletedMagicLinks.length,
      }, 'Purged expired authentication data at startup');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to purge expired authentication data');
    // Non-critical: don't block startup if purge fails
  }
}

