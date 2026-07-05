/**
 * Stream events purge sweep wrapper (BR-44 WI-2).
 *
 * Mirrors the chat-trace-sweep.ts pattern: wraps the core purge function
 * with logging and error swallowing so a sweep failure never crashes the server.
 */

import { env } from '../../config/env';
import { logger } from '../../logger';
import { purgeOldStreamEvents } from './stream-purge';

export async function runStreamEventsPurge(): Promise<void> {
  const retentionDays = env.STREAM_RETENTION_DAYS ?? 7;
  try {
    const deleted = await purgeOldStreamEvents(retentionDays);
    if (deleted > 0) {
      logger.info({ deleted, retentionDays }, 'Purged old chat stream events');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to purge old chat stream events');
  }
}
