import { env } from './config/env';
import { logger } from './logger';
import { runMigrations } from './db/run-migrations';
import { ensureIndexes } from './db/ensure-indexes';
import { purgeExpiredAuthData } from './services/challenge-purge';
import { ensureAdminWorkspaceExists, claimAdminWorkspaceOwner } from './services/workspace-service';
import { runAdminApprovalSweep } from './services/admin-approval-sweep';
import { runChatTracePurge } from './services/chat-trace-sweep';

const port = env.PORT;

// Run database migrations at boot (idempotent)
try {
  logger.info('Running database migrations at startup...');
  await runMigrations();
  logger.info('Database migrations completed.');
} catch (error) {
  logger.error({ err: error }, 'Database migration failed at startup');
  process.exit(1);
}

// Ensure indexes exist at boot (idempotent)
try {
  logger.info('Ensuring database indexes at startup...');
  await ensureIndexes();
  logger.info('Database indexes ensured.');
} catch (error) {
  logger.error({ err: error }, 'Database index creation failed at startup');
  process.exit(1);
}

// Purge expired authentication data (challenges, magic links)
try {
  await purgeExpiredAuthData();
} catch (error) {
  logger.error({ err: error }, 'Failed to purge expired auth data at startup, continuing anyway');
  // Non-critical: don't block startup if purge fails
}

// Ensure Admin Workspace exists (idempotent) and is claimed by admin_app if present
try {
  await ensureAdminWorkspaceExists();
  await claimAdminWorkspaceOwner();
} catch (error) {
  logger.error({ err: error }, 'Failed to ensure admin workspace at startup, continuing anyway');
}

// Admin approval sweep (48h -> read-only). Run once at boot, then periodically.
if (process.env.NODE_ENV !== 'test') {
  try {
    await runAdminApprovalSweep();
  } catch (error) {
    logger.error({ err: error }, 'Admin approval sweep failed at startup, continuing anyway');
  }

  setInterval(() => {
    runAdminApprovalSweep().catch((error) => {
      logger.error({ err: error }, 'Admin approval sweep failed');
    });
  }, 15 * 60 * 1000); // every 15 minutes

  // Chat trace purge (retention > 7 days). Run once at boot, then daily.
  try {
    await runChatTracePurge();
  } catch {
    // already logged inside
  }
  setInterval(() => {
    void runChatTracePurge();
  }, 24 * 60 * 60 * 1000);
}

const [{ serve }, { app }] = await Promise.all([
  import('@hono/node-server'),
  import('./app')
]);

serve({ fetch: app.fetch, port });
logger.info(`API server listening on http://0.0.0.0:${port}`);
