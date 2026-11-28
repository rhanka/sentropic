import { logger } from '../logger';
import { purgeExpiredMagicLinkContinuations } from './auth/magic-link-continuation';
import { purgeCmExpiredProofs } from './identity/cm-proofs';

/**
 * Purge expired single-use proofs from the cluster-mesh identity custody store
 * (WebAuthn challenges, magic links, email codes) and expired magic-link continuations.
 *
 * Called at API startup (cold start) to clean up stale data.
 * Prevents database bloat from accumulating expired authentication tokens.
 */
export async function purgeExpiredAuthData(): Promise<void> {
  try {
    const purged = await purgeCmExpiredProofs();
    const purgedContinuations = await purgeExpiredMagicLinkContinuations();
    if (purged > 0 || purgedContinuations > 0) {
      logger.info({ purged, purgedContinuations }, 'Purged expired authentication data at startup');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to purge expired authentication data');
    // Non-critical: don't block startup if purge fails
  }
}
