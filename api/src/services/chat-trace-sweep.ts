import { env } from '../config/env';
import { logger } from '../logger';
import { purgeOldChatTraces } from './chat-trace';

export async function runChatTracePurge(): Promise<void> {
  const retentionDays = env.CHAT_TRACE_RETENTION_DAYS ?? 7;
  try {
    const deleted = await purgeOldChatTraces(retentionDays);
    if (deleted > 0) {
      logger.info({ deleted, retentionDays }, 'Purged old chat generation traces');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to purge old chat generation traces');
  }
}


