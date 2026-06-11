/**
 * Queue reaper sweep wrapper (BR-44 WI-1).
 *
 * Mirrors the chat-trace-sweep.ts / admin-approval-sweep.ts pattern:
 * wraps the core reaper with logging and error swallowing so
 * a sweep failure never crashes the server.
 */

import { logger } from '../logger';
import { runQueueReaper } from './queue-reaper';

/**
 * Run the queue reaper sweep.
 *
 * @param liveJobIds - ids of currently in-flight jobs (from jobControllers).
 *   Pass an empty array for the boot sweep.
 */
export async function runQueueReaperSweep(liveJobIds: string[]): Promise<void> {
  try {
    const result = await runQueueReaper(liveJobIds);
    if (result.requeued > 0 || result.failed > 0 || result.chatMessagesFailed > 0) {
      logger.info(
        { requeued: result.requeued, failed: result.failed, chatMessagesFailed: result.chatMessagesFailed },
        'Queue reaper: recovered stranded jobs',
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Queue reaper sweep failed');
  }
}
