/**
 * Outbox dispatcher sweep wrapper.
 *
 * Mirrors the queue-reaper-sweep.ts pattern:
 * wraps the dispatcher sweep with logging and error swallowing so a sweep
 * failure never crashes the server.
 *
 * Used by the periodic timer inside OutboxDispatcher; also exposed for
 * explicit callers (e.g., tests driving a manual sweep).
 */

import { logger } from '../../logger';
import { outboxDispatcher } from './outbox-dispatcher';

/**
 * Run one outbox dispatch sweep (claim + emit pending rows).
 * Errors are logged and swallowed.
 */
export async function runOutboxDispatcherSweep(): Promise<void> {
  try {
    const result = await outboxDispatcher.runDispatchSweep();
    if (result.dispatched > 0 || result.failed > 0 || result.staleReclaimed > 0) {
      logger.info(result, 'outbox-dispatcher: sweep completed');
    }
  } catch (error) {
    logger.error({ err: error }, 'outbox-dispatcher: sweep failed');
  }
}
