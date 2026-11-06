import { logger } from '../logger';
import { purgeCmExpiredProofs } from './identity/cm-proofs';

/**
 * Purge expired single-use proofs from the cluster-mesh identity custody store
 * (WebAuthn challenges, magic links, email codes).
 *
 * Called at API startup (cold start) to clean up stale data.
 * Prevents database bloat from accumulating expired authentication tokens.
 */
export async function purgeExpiredAuthData(): Promise<void> {
  try {
    const purged = await purgeCmExpiredProofs();
    if (purged > 0) {
      logger.info({ purged }, 'Purged expired authentication data at startup');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to purge expired authentication data');
    // Non-critical: don't block startup if purge fails
  }
}
