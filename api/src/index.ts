import { env } from './config/env';
import { logger } from './logger';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './db/client';
import { purgeExpiredAuthData } from './services/challenge-purge';

const port = env.PORT;

// Run database migrations at boot (idempotent)
try {
  logger.info('Running database migrations at startup...');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('Database migrations completed.');
} catch (error) {
  logger.error({ err: error }, 'Database migration failed at startup');
  process.exit(1);
}

// Purge expired authentication data (challenges, magic links)
try {
  await purgeExpiredAuthData();
} catch (error) {
  logger.error({ err: error }, 'Failed to purge expired auth data at startup, continuing anyway');
  // Non-critical: don't block startup if purge fails
}

const [{ serve }, { app }] = await Promise.all([
  import('@hono/node-server'),
  import('./app')
]);

serve({ fetch: app.fetch, port });
logger.info(`API server listening on http://0.0.0.0:${port}`);
